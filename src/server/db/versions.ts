import { DatabaseSync } from "node:sqlite";
import type {
  ScenarioAssumptions,
  ScenarioFormulas,
  CoreAccount,
} from "../../domain/types.ts";
import {
  withTransaction,
  actualsVersionId,
} from "./utils.ts";
import type { VersionRow, ScenarioRow } from "./utils.ts";
import { selectCubeRows } from "./actuals.ts";
import { insertForecastRows, selectForecastRowsByScenarioId } from "./forecasts.ts";
import { validateFormula } from "../../domain/formulaEngine.ts";
import { recalculateScenario } from "./forecasts.ts";
import {
  readVarValues,
  replaceVarValues,
  deleteCustomVariableValuesByScenario,
  listCustomVariables,
} from "./customVariables.ts";

export type ScenarioRecord = {
  id: string;
  name: string;
  locked: boolean;
  assumptions: ScenarioAssumptions;
  updatedAt: string;
};

export type VersionRecord = {
  id: string;
  name: string;
  kind: "actuals" | "scenario";
  locked: boolean;
  sortOrder: number;
  canLock: boolean;
  canRename: boolean;
  canDelete: boolean;
  updatedAt?: string;
};

export function listVersions(db: DatabaseSync): VersionRecord[] {
  return (
    db.prepare("select * from versions order by kind, sort_order, name").all() as VersionRow[]
  ).map((version) => ({
    id: version.id,
    name: version.name,
    kind: version.kind,
    locked: Boolean(version.locked),
    sortOrder: version.sort_order ?? 0,
    canLock: version.kind === "scenario",
    canRename: version.kind !== "actuals",
    canDelete: version.kind !== "actuals",
    updatedAt: version.updated_at,
  }));
}

export function createVersion(db: DatabaseSync, rawName: string, sourceId: string): VersionRecord {
  const name = normalizeVersionName(rawName);
  ensureVersionNameAvailable(db, name, null);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const assumptions =
    sourceId === actualsVersionId
      ? emptyScenarioAssumptions(name)
      : { ...readScenarioById(db, sourceId).assumptions, name };
  withTransaction(db, () => {
    db.prepare(
      "insert into versions (id, name, kind, sort_order, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
    ).run(id, name, "scenario", (listVersions(db).length + 1) * 10, now, now);
    db.prepare("insert into scenarios (id, name, created_at, updated_at) values (?, ?, ?, ?)").run(
      id,
      name,
      now,
      now,
    );
    replaceVarValues(db, id, assumptions);
    replaceScenarioFormulas(db, id, assumptions.formulas);
    const sourceRows =
      sourceId === actualsVersionId
        ? selectCubeRows(db, "actuals")
        : selectForecastRowsByScenarioId(db, sourceId);
    insertForecastRows(db, id, sourceRows);
  });
  return listVersions(db).find((version) => version.id === id)!;
}

export function updateVersion(
  db: DatabaseSync,
  id: string,
  changes: { name?: string; locked?: boolean; sortOrder?: number },
): VersionRecord {
  const current = readVersionById(db, id);
  if (current.kind === "actuals" && changes.name !== undefined) {
    throw new Error("Actuals cannot be renamed.");
  }
  if (current.kind === "actuals" && changes.locked !== undefined) {
    throw new Error("Actuals cannot be locked.");
  }
  const name =
    changes.name !== undefined
      ? normalizeVersionName(changes.name)
      : normalizeVersionName(current.name);
  ensureVersionNameAvailable(db, name, id);
  const now = new Date().toISOString();
  withTransaction(db, () => {
    if (changes.sortOrder !== undefined) {
      db.prepare("update versions set sort_order = ?, updated_at = ? where id = ?").run(
        changes.sortOrder,
        now,
        id,
      );
    }
    db.prepare("update versions set name = ?, locked = ?, updated_at = ? where id = ?").run(
      name,
      changes.locked === undefined ? current.locked : changes.locked ? 1 : 0,
      now,
      id,
    );
    db.prepare("update scenarios set name = ?, updated_at = ? where id = ?").run(name, now, id);
  });
  return listVersions(db).find((version) => version.id === id)!;
}

export function deleteVersion(db: DatabaseSync, id: string): void {
  if (id === actualsVersionId) {
    throw new Error("Actuals cannot be deleted.");
  }
  readScenarioById(db, id);
  withTransaction(db, () => {
    db.prepare("delete from forecast_values where scenario_id = ?").run(id);
    db.prepare("delete from driver_assumptions where scenario_id = ?").run(id);
    db.prepare("delete from scenario_formulas where scenario_id = ?").run(id);
    deleteCustomVariableValuesByScenario(db, id);
    db.prepare("delete from scenarios where id = ?").run(id);
    db.prepare("delete from versions where id = ?").run(id);
  });
}

export function normalizeVersionName(value: string): string {
  const name = value.trim();
  if (!name) {
    throw new Error("Version name is required.");
  }
  if (name === "Actuals") {
    throw new Error("Actuals is reserved.");
  }
  return name;
}

export function ensureVersionNameAvailable(
  db: DatabaseSync,
  name: string,
  currentScenarioId: string | null,
): void {
  const existing = db.prepare("select id from versions where name = ?").get(name) as
    | { id: string }
    | undefined;
  if (existing && existing.id !== currentScenarioId) {
    throw new Error(`${name} already exists.`);
  }
}

export function readScenarioById(db: DatabaseSync, id: string): ScenarioRecord {
  const scenario = readScenarios(db).find((item) => item.id === id);
  if (!scenario) {
    throw new Error("Version not found.");
  }
  return scenario;
}

export function readVersionById(db: DatabaseSync, id: string): VersionRow {
  const version = db.prepare("select * from versions where id = ?").get(id) as
    | VersionRow
    | undefined;
  if (!version) {
    throw new Error("Version not found.");
  }
  return version;
}

export function isVersionLocked(db: DatabaseSync, id: string): boolean {
  const version = db.prepare("select locked from versions where id = ?").get(id) as
    | { locked: number }
    | undefined;
  return Boolean(version?.locked);
}

export function emptyScenarioAssumptions(name: string): ScenarioAssumptions {
  return {
    name,
    varGlobal: {
      revenueGrowthRate: 0,
      cogsPctOfRevenue: 0,
      headcountGrowthRate: 0,
      costPerHead: 0,
    },
  };
}

export function replaceScenarioFormulas(
  db: DatabaseSync,
  scenarioId: string,
  formulas: ScenarioFormulas | undefined,
): void {
  db.prepare("delete from scenario_formulas where scenario_id = ?").run(scenarioId);
  if (!formulas) return;
  const insert = db.prepare(
    "insert into scenario_formulas (scenario_id, account, formula) values (?, ?, ?)",
  );
  for (const [account, formula] of Object.entries(formulas)) {
    if (formula) insert.run(scenarioId, account, formula);
  }
}

export function readScenarioFormulas(db: DatabaseSync, scenarioId: string): ScenarioFormulas {
  const rows = db
    .prepare("select account, formula from scenario_formulas where scenario_id = ?")
    .all(scenarioId) as { account: string; formula: string }[];
  const result: ScenarioFormulas = {};
  for (const row of rows) {
    result[row.account as CoreAccount] = row.formula;
  }
  return result;
}

export function readScenarios(db: DatabaseSync): ScenarioRecord[] {
  const rows = db
    .prepare(`
      select scenarios.id, versions.name, versions.locked, versions.updated_at, versions.sort_order
      from scenarios
      join versions on versions.id = scenarios.id
      where versions.kind = 'scenario'
      order by versions.sort_order, versions.name
    `)
    .all() as (ScenarioRow & { locked: number; sort_order: number | null })[];

  return rows.map((row) => {
    const { varGlobal, varMonthly, varOverrides } = readVarValues(db, row.id);
    const formulas = readScenarioFormulas(db, row.id);
    const assumptions: ScenarioAssumptions = { name: row.name };
    if (Object.keys(varGlobal).length > 0) assumptions.varGlobal = varGlobal;
    if (Object.keys(varMonthly).length > 0) assumptions.varMonthly = varMonthly;
    if (Object.keys(varOverrides).length > 0) assumptions.varOverrides = varOverrides;
    if (Object.keys(formulas).length > 0) assumptions.formulas = formulas;
    return {
      id: row.id,
      name: row.name,
      locked: Boolean(row.locked),
      assumptions,
      updatedAt: row.updated_at,
    };
  });
}

export function backfillVersionOrder(db: DatabaseSync): void {
  const versions = db
    .prepare("select id, name, kind, sort_order from versions order by kind, name")
    .all() as { id: string; name: string; kind: string; sort_order: number | null }[];
  if (!versions.some((v) => v.sort_order === null)) return;

  const sorted = versions.sort(
    (left, right) =>
      (left.kind === "actuals" ? 0 : 1) - (right.kind === "actuals" ? 0 : 1) ||
      scenarioOrder(left.name) - scenarioOrder(right.name) ||
      left.name.localeCompare(right.name),
  );

  const update = db.prepare("update versions set sort_order = ? where id = ?");
  withTransaction(db, () => {
    for (let i = 0; i < sorted.length; i++) {
      update.run((i + 1) * 10, sorted[i].id);
    }
  });
}

export function scenarioOrder(name: string): number {
  return ["Base Case", "Aggressive Growth", "Conservative"].indexOf(name) === -1
    ? 99
    : ["Base Case", "Aggressive Growth", "Conservative"].indexOf(name);
}

export function upsertScenario(db: DatabaseSync, assumptions: ScenarioAssumptions): ScenarioRecord {
  const existing = db
    .prepare("select id, locked from versions where name = ?")
    .get(assumptions.name) as { id: string; locked: number } | undefined;
  if (existing?.locked) {
    throw new Error(`${assumptions.name} is locked and cannot be edited.`);
  }
  const id = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const customVarSentinels = Object.fromEntries(listCustomVariables(db).map((v) => [v.id, 1]));
  for (const [account, formula] of Object.entries(assumptions.formulas ?? {})) {
    if (!formula) continue;
    const result = validateFormula(formula, account as CoreAccount, customVarSentinels);
    if (!result.ok) {
      throw new Error(`Invalid formula for ${account}: ${result.error}`);
    }
  }
  withTransaction(db, () => {
    db.prepare(`
      insert into versions (id, name, kind, created_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set name = excluded.name, updated_at = excluded.updated_at
    `).run(id, assumptions.name, "scenario", now, now);
    db.prepare(`
      insert into scenarios (id, name, created_at, updated_at)
      values (?, ?, ?, ?)
      on conflict(id) do update set name = excluded.name, updated_at = excluded.updated_at
    `).run(id, assumptions.name, now, now);
    replaceVarValues(db, id, assumptions);
    replaceScenarioFormulas(db, id, assumptions.formulas);
  });
  recalculateScenario(db, assumptions.name);
  return readScenarios(db).find((scenario) => scenario.name === assumptions.name)!;
}
