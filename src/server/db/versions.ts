import { DatabaseSync } from "node:sqlite";
import type {
  ScenarioAssumptions,
  ScenarioFormulas,
  CoreAccount,
  DriverAssumptions,
} from "../../domain/types.ts";
import {
  withTransaction,
  allMonths,
  actualsVersionId,
  globalScopeKey,
  driverKeys,
} from "./utils.ts";
import type { DriverKey, VersionRow, ScenarioRow, DriverAssumptionRow } from "./utils.ts";
import { selectCubeRows } from "./actuals.ts";
import { insertForecastRows, selectForecastRowsByScenarioId } from "./forecasts.ts";
import { validateFormula } from "../../domain/formulaEngine.ts";
import { recalculateScenario } from "./forecasts.ts";
import {
  readCustomVarValues,
  replaceCustomVarValues,
  deleteCustomVariableValuesByScenario,
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
    replaceDriverAssumptions(db, id, assumptions);
    replaceScenarioFormulas(db, id, assumptions.formulas);
    replaceCustomVarValues(db, id, assumptions);
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
  const scenario = readScenarioById(db, id);
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
    if (changes.name !== undefined) {
      replaceDriverAssumptions(db, id, { ...scenario.assumptions, name });
    }
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
    global: {
      revenueGrowthRate: 0,
      cogsPctOfRevenue: 0,
      headcountGrowthRate: 0,
      costPerHead: 0,
    },
    monthly: {},
    overrides: {},
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

export function replaceDriverAssumptions(
  db: DatabaseSync,
  scenarioId: string,
  assumptions: ScenarioAssumptions,
): void {
  db.prepare("delete from driver_assumptions where scenario_id = ?").run(scenarioId);
  const insert = db.prepare(`
    insert into driver_assumptions (scenario_id, scope_type, scope_key, month, driver_key, value)
    values (?, ?, ?, ?, ?, ?)
  `);
  const insertDrivers = (
    scopeType: "global" | "department",
    scopeKey: string,
    month: string,
    drivers: Partial<DriverAssumptions>,
  ) => {
    for (const key of driverKeys) {
      const value = drivers[key];
      if (value !== undefined) {
        insert.run(scenarioId, scopeType, scopeKey, month, key, value);
      }
    }
  };

  insertDrivers("global", globalScopeKey, allMonths, assumptions.global);
  for (const [month, drivers] of Object.entries(assumptions.monthly ?? {})) {
    insertDrivers("global", globalScopeKey, month, drivers);
  }
  for (const [department, override] of Object.entries(assumptions.overrides)) {
    const { monthly, ...defaultDrivers } = override;
    insertDrivers("department", department, allMonths, defaultDrivers);
    for (const [month, drivers] of Object.entries(monthly ?? {})) {
      insertDrivers("department", department, month, drivers);
    }
  }
}

export function readDriverAssumptions(
  db: DatabaseSync,
  scenario: ScenarioRow,
): ScenarioAssumptions {
  const rows = db
    .prepare(
      "select scenario_id, scope_type, scope_key, month, driver_key, value from driver_assumptions where scenario_id = ?",
    )
    .all(scenario.id) as DriverAssumptionRow[];
  const assumptions: ScenarioAssumptions = {
    name: scenario.name,
    global: {
      revenueGrowthRate: 0,
      cogsPctOfRevenue: 0,
      headcountGrowthRate: 0,
      costPerHead: 0,
    },
    monthly: {},
    overrides: {},
  };

  for (const row of rows) {
    if (!isDriverKey(row.driver_key)) {
      continue;
    }
    if (row.scope_type === "global") {
      if (row.month === allMonths) {
        assumptions.global[row.driver_key] = row.value;
      } else {
        assumptions.monthly ??= {};
        assumptions.monthly[row.month] ??= {};
        assumptions.monthly[row.month][row.driver_key] = row.value;
      }
      continue;
    }
    if (row.scope_type === "department") {
      const override = (assumptions.overrides[row.scope_key] ??= {});
      if (row.month === allMonths) {
        override[row.driver_key] = row.value;
      } else {
        override.monthly ??= {};
        override.monthly[row.month] ??= {};
        override.monthly[row.month][row.driver_key] = row.value;
      }
    }
  }

  if (Object.keys(assumptions.monthly ?? {}).length === 0) {
    delete assumptions.monthly;
  }
  return assumptions;
}

export function isDriverKey(value: string): value is DriverKey {
  return driverKeys.includes(value as DriverKey);
}

export function readScenarios(db: DatabaseSync): ScenarioRecord[] {
  return (
    db
      .prepare(`
    select scenarios.id, versions.name, versions.locked, versions.updated_at
    from scenarios
    join versions on versions.id = scenarios.id
    where versions.kind = 'scenario'
    order by versions.name
  `)
      .all() as (ScenarioRow & { locked: number })[]
  )
    .map((row) => {
      const assumptions = readDriverAssumptions(db, row);
      const formulas = readScenarioFormulas(db, row.id);
      if (Object.keys(formulas).length > 0) {
        assumptions.formulas = formulas;
      }
      const customVarData = readCustomVarValues(db, row.id);
      if (Object.keys(customVarData.customVarGlobal).length > 0) {
        assumptions.customVarGlobal = customVarData.customVarGlobal;
      }
      if (Object.keys(customVarData.customVarMonthly).length > 0) {
        assumptions.customVarMonthly = customVarData.customVarMonthly;
      }
      if (Object.keys(customVarData.customVarOverrides).length > 0) {
        assumptions.customVarOverrides = customVarData.customVarOverrides;
      }
      return {
        id: row.id,
        name: row.name,
        locked: Boolean(row.locked),
        assumptions,
        updatedAt: row.updated_at,
      };
    })
    .sort((left, right) => {
      const leftVersion = db
        .prepare("select sort_order from versions where id = ?")
        .get(left.id) as { sort_order: number };
      const rightVersion = db
        .prepare("select sort_order from versions where id = ?")
        .get(right.id) as { sort_order: number };
      return (
        (leftVersion?.sort_order ?? 0) - (rightVersion?.sort_order ?? 0) ||
        left.name.localeCompare(right.name)
      );
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
  for (const [account, formula] of Object.entries(assumptions.formulas ?? {})) {
    if (!formula) continue;
    const result = validateFormula(formula, account as CoreAccount);
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
    replaceDriverAssumptions(db, id, assumptions);
    replaceScenarioFormulas(db, id, assumptions.formulas);
    replaceCustomVarValues(db, id, assumptions);
  });
  recalculateScenario(db, assumptions.name);
  return readScenarios(db).find((scenario) => scenario.name === assumptions.name)!;
}
