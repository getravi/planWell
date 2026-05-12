import { DatabaseSync } from "node:sqlite";
import type {
  DimensionImpact,
  DimensionKind,
  DimensionMember,
  ActualRow,
} from "../../domain/types.ts";
import { withTransaction } from "./utils.ts";
import type { DimensionRow } from "./utils.ts";
import { countRows } from "./actuals.ts";
import {
  countScenarioOverrides,
  renameScenarioOverride,
  deleteScenarioOverride,
  recalculateAll,
} from "./forecasts.ts";

export function createDimensionMember(
  db: DatabaseSync,
  kind: DimensionKind,
  rawName: string,
  rawParentName: string | null,
): void {
  if (kind === "time") {
    const months = expandTimeMembers(rawName);
    const existingCount = months.filter((month) => dimensionExists(db, kind, month)).length;
    if (existingCount === months.length) {
      throw new Error(`${rawName.trim()} already exists.`);
    }
    const insert = db.prepare("insert or ignore into time_month (id) values (?)");
    withTransaction(db, () => {
      for (const month of months) {
        insert.run(month);
      }
    });
    return;
  }

  const name = normalizeDimensionName(kind, rawName);
  const parentName = normalizeOptionalName(rawParentName);
  ensureNamedDimensionCanSave(db, kind, name, parentName, null);
  withTransaction(db, () => {
    insertNamedDimensionIfMissing(db, kind, name, parentName);
    if (kind === "account") {
      propagateNewAccount(db, name);
    }
  });
}

export function updateDimensionMember(
  db: DatabaseSync,
  kind: DimensionKind,
  rawName: string,
  changes: { name?: string; parentName?: string | null; sortOrder?: number },
): void {
  const currentName = normalizeDimensionName(kind, rawName);
  const nextName =
    changes.name === undefined ? currentName : normalizeDimensionName(kind, changes.name);
  if (kind === "time") {
    updateTimeMember(db, currentName, nextName);
    return;
  }

  const table = dimensionTable(kind);
  const current = getNamedDimensionRow(db, kind, currentName);
  const parentName =
    changes.parentName === undefined
      ? current.parent_name
      : normalizeOptionalName(changes.parentName);
  const sortOrder =
    changes.sortOrder ??
    (parentName === current.parent_name
      ? (current.sort_order ?? nextSortOrder(db, kind, parentName))
      : nextSortOrder(db, kind, parentName));
  ensureNamedDimensionCanSave(db, kind, nextName, parentName, currentName);
  const shouldRecalculateForecasts =
    kind === "department" && (nextName !== currentName || parentName !== current.parent_name);

  withTransaction(db, () => {
    db.prepare(`update ${table} set name = ?, parent_name = ?, sort_order = ? where name = ?`).run(
      nextName,
      parentName,
      sortOrder,
      currentName,
    );
    db.prepare(`update ${table} set parent_name = ? where parent_name = ?`).run(
      nextName,
      currentName,
    );
    if (kind === "department") {
      db.prepare("update actuals set department = ? where department = ?").run(
        nextName,
        currentName,
      );
      db.prepare("update forecast_values set department = ? where department = ?").run(
        nextName,
        currentName,
      );
      renameScenarioOverride(db, currentName, nextName);
    } else {
      db.prepare("update actuals set account = ? where account = ?").run(nextName, currentName);
      db.prepare("update forecast_values set account = ? where account = ?").run(
        nextName,
        currentName,
      );
    }
    normalizeSiblingOrder(db, kind, parentName);
    if (current.parent_name !== parentName) {
      normalizeSiblingOrder(db, kind, current.parent_name);
    }
  });
  if (shouldRecalculateForecasts) {
    recalculateAll(db);
  }
}

export function updateTimeMember(db: DatabaseSync, currentName: string, nextName: string): void {
  ensureTimeName(currentName);
  ensureTimeName(nextName);
  if (!dimensionExists(db, "time", currentName)) {
    throw new Error(`time member not found: ${currentName}`);
  }
  if (currentName !== nextName && dimensionExists(db, "time", nextName)) {
    throw new Error(`${nextName} already exists.`);
  }
  withTransaction(db, () => {
    db.prepare("update time_month set id = ? where id = ?").run(nextName, currentName);
    db.prepare("update actuals set month = ? where month = ?").run(nextName, currentName);
    db.prepare("update forecast_values set month = ? where month = ?").run(nextName, currentName);
  });
}

export function getDimensionImpact(
  db: DatabaseSync,
  kind: DimensionKind,
  rawName: string,
): DimensionImpact {
  const name = normalizeDimensionName(kind, rawName);
  if (kind === "time") {
    return {
      actualRows: countRows(db, "actuals", "month", name),
      forecastRows: countRows(db, "forecast_values", "month", name),
      scenarioOverrides: 0,
      childCount: 0,
    };
  }
  const column = kind;
  return {
    actualRows: countRows(db, "actuals", column, name),
    forecastRows: countRows(db, "forecast_values", column, name),
    scenarioOverrides: kind === "department" ? countScenarioOverrides(db, name) : 0,
    childCount: countChildren(db, kind, name),
  };
}

export function deleteDimensionMember(
  db: DatabaseSync,
  kind: DimensionKind,
  rawName: string,
  force: boolean,
): DimensionImpact {
  const name = normalizeDimensionName(kind, rawName);
  if (!dimensionExists(db, kind, name)) {
    throw new Error(`${kind} member not found: ${name}`);
  }
  const impact = getDimensionImpact(db, kind, name);
  const hasReferences =
    impact.actualRows + impact.forecastRows + impact.scenarioOverrides + impact.childCount > 0;
  if (hasReferences && !force) {
    throw new DimensionReferenceError(impact);
  }

  withTransaction(db, () => {
    if (kind === "time") {
      db.prepare("delete from actuals where month = ?").run(name);
      db.prepare("delete from forecast_values where month = ?").run(name);
      db.prepare("delete from time_month where id = ?").run(name);
      return;
    }
    const table = dimensionTable(kind);
    const column = kind;
    db.prepare(`update ${table} set parent_name = null where parent_name = ?`).run(name);
    db.prepare(`delete from actuals where ${column} = ?`).run(name);
    db.prepare(`delete from forecast_values where ${column} = ?`).run(name);
    db.prepare(`delete from ${table} where name = ?`).run(name);
    if (kind === "department") {
      deleteScenarioOverride(db, name);
    }
  });
  if (kind === "department") {
    recalculateAll(db);
  }
  return impact;
}

export class DimensionReferenceError extends Error {
  readonly impact: DimensionImpact;

  constructor(impact: DimensionImpact) {
    super("Dimension member has existing references.");
    this.impact = impact;
  }
}

export function listNamedDimension(
  db: DatabaseSync,
  kind: "department" | "account",
): DimensionMember[] {
  const table = dimensionTable(kind);
  const rows = db
    .prepare(`select name, parent_name, sort_order from ${table}`)
    .all() as DimensionRow[];
  const byName = new Map<string, DimensionMember>();
  for (const row of rows) {
    byName.set(row.name, {
      name: row.name,
      parentName: row.parent_name,
      sortOrder: row.sort_order ?? 0,
      referenceCount: getReferenceCount(db, kind, row.name),
      children: [],
    });
  }
  for (const row of rows) {
    const member = byName.get(row.name);
    const parent = row.parent_name ? byName.get(row.parent_name) : undefined;
    if (member && parent) {
      parent.children.push(member);
    }
  }
  const roots = [...byName.values()].filter(
    (member) => !member.parentName || !byName.has(member.parentName),
  );
  sortDimensionTree(roots);
  return roots;
}

export function listTimeDimension(db: DatabaseSync): DimensionMember[] {
  const months = (
    db
      .prepare(
        `
          select id from time_month
          union
          select month as id from actuals
          union
          select month as id from forecast_values
          order by id
        `,
      )
      .all() as { id: string }[]
  ).map((row) => row.id);
  const years = new Map<string, DimensionMember>();
  for (const month of months) {
    const [year, monthNumberRaw] = month.split("-");
    const quarter = `${year} Q${Math.ceil(Number(monthNumberRaw) / 3)}`;
    const yearMember = years.get(year) ?? {
      name: year,
      parentName: null,
      referenceCount: 0,
      children: [],
    };
    years.set(year, yearMember);
    let quarterMember = yearMember.children.find((child) => child.name === quarter);
    if (!quarterMember) {
      quarterMember = { name: quarter, parentName: year, referenceCount: 0, children: [] };
      yearMember.children.push(quarterMember);
    }
    const referenceCount = getReferenceCount(db, "time", month);
    quarterMember.children.push({
      name: month,
      parentName: quarter,
      referenceCount,
      children: [],
    });
    quarterMember.referenceCount += referenceCount;
    yearMember.referenceCount += referenceCount;
  }
  const roots = [...years.values()];
  sortDimensionTree(roots);
  return roots;
}

export function sortDimensionTree(members: DimensionMember[]): void {
  members.sort(
    (left, right) =>
      (left.sortOrder ?? Number.POSITIVE_INFINITY) -
        (right.sortOrder ?? Number.POSITIVE_INFINITY) || left.name.localeCompare(right.name),
  );
  for (const member of members) {
    sortDimensionTree(member.children);
  }
}

export function ensureNamedDimensionCanSave(
  db: DatabaseSync,
  kind: "department" | "account",
  name: string,
  parentName: string | null,
  currentName: string | null,
): void {
  if (dimensionExists(db, kind, name) && name !== currentName) {
    throw new Error(`${name} already exists.`);
  }
  if (parentName === name || (currentName !== null && parentName === currentName)) {
    throw new Error("A member cannot be its own parent.");
  }
  if (parentName && !dimensionExists(db, kind, parentName)) {
    throw new Error(`Parent member not found: ${parentName}`);
  }
  if (currentName && parentName && getDescendants(db, kind, currentName).includes(parentName)) {
    throw new Error("Hierarchy cycle detected.");
  }
}

export function insertNamedDimensionIfMissing(
  db: DatabaseSync,
  kind: "department" | "account",
  name: string,
  parentName: string | null,
): void {
  if (dimensionExists(db, kind, name)) {
    return;
  }
  const table = dimensionTable(kind);
  db.prepare(`insert into ${table} (name, parent_name, sort_order) values (?, ?, ?)`).run(
    name,
    parentName,
    nextSortOrder(db, kind, parentName),
  );
}

export function nextSortOrder(
  db: DatabaseSync,
  kind: "department" | "account",
  parentName: string | null,
): number {
  const table = dimensionTable(kind);
  const row = db
    .prepare(
      parentName
        ? `select coalesce(max(sort_order), -1) + 1 as next_order from ${table} where parent_name = ?`
        : `select coalesce(max(sort_order), -1) + 1 as next_order from ${table} where parent_name is null`,
    )
    .get(...(parentName ? [parentName] : [])) as { next_order: number };
  return row.next_order;
}

export function normalizeSiblingOrder(
  db: DatabaseSync,
  kind: "department" | "account",
  parentName: string | null,
): void {
  const table = dimensionTable(kind);
  const rows = (
    parentName
      ? db
          .prepare(
            `select name, parent_name, sort_order from ${table} where parent_name = ? order by sort_order, name`,
          )
          .all(parentName)
      : db
          .prepare(
            `select name, parent_name, sort_order from ${table} where parent_name is null order by sort_order, name`,
          )
          .all()
  ) as DimensionRow[];
  const update = db.prepare(`update ${table} set sort_order = ? where name = ?`);
  rows.forEach((row, index) => update.run(index, row.name));
}

export function backfillDimensionOrder(db: DatabaseSync, kind: "department" | "account"): void {
  const table = dimensionTable(kind);
  const rows = db.prepare(`select name, parent_name, sort_order from ${table}`).all() as
    | DimensionRow[]
    | [];
  const parentNames = new Set<string | null>(rows.map((row) => row.parent_name));
  for (const parentName of parentNames) {
    normalizeSiblingOrder(db, kind, parentName);
  }
}

export function getNamedDimensionRow(
  db: DatabaseSync,
  kind: "department" | "account",
  name: string,
): DimensionRow {
  const table = dimensionTable(kind);
  const row = db
    .prepare(`select name, parent_name, sort_order from ${table} where name = ?`)
    .get(name) as DimensionRow | undefined;
  if (!row) {
    throw new Error(`${kind} member not found: ${name}`);
  }
  return row;
}

export function getDescendants(
  db: DatabaseSync,
  kind: "department" | "account",
  name: string,
): string[] {
  const table = dimensionTable(kind);
  const rows = db.prepare(`select name, parent_name from ${table}`).all() as DimensionRow[];
  const descendants: string[] = [];
  const visit = (parentName: string) => {
    for (const child of rows.filter((row) => row.parent_name === parentName)) {
      descendants.push(child.name);
      visit(child.name);
    }
  };
  visit(name);
  return descendants;
}

export function dimensionExists(db: DatabaseSync, kind: DimensionKind, name: string): boolean {
  const table = kind === "time" ? "time_month" : dimensionTable(kind);
  const column = kind === "time" ? "id" : "name";
  return Boolean(db.prepare(`select ${column} from ${table} where ${column} = ?`).get(name));
}

export function dimensionTable(kind: "department" | "account"): string {
  return kind;
}

export function normalizeDimensionName(kind: DimensionKind, value: string): string {
  const name = value.trim();
  if (!name) {
    throw new Error(`${kind} name is required.`);
  }
  if (kind === "time") {
    ensureTimeName(name);
  }
  return name;
}

export function normalizeOptionalName(value: string | null | undefined): string | null {
  const name = value?.trim();
  return name ? name : null;
}

export function ensureTimeName(name: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(name)) {
    throw new Error("Time members must use YYYY-MM.");
  }
}

export function expandTimeMembers(value: string): string[] {
  const name = value.trim();
  if (/^\d{4}$/.test(name)) {
    return Array.from(
      { length: 12 },
      (_, index) => `${name}-${String(index + 1).padStart(2, "0")}`,
    );
  }
  ensureTimeName(name);
  return [name];
}

export function getReferenceCount(db: DatabaseSync, kind: DimensionKind, name: string): number {
  const column = kind === "time" ? "month" : kind;
  return countRows(db, "actuals", column, name) + countRows(db, "forecast_values", column, name);
}

export function countChildren(
  db: DatabaseSync,
  kind: "department" | "account",
  name: string,
): number {
  const table = dimensionTable(kind);
  const row = db
    .prepare(`select count(*) as count from ${table} where parent_name = ?`)
    .get(name) as {
    count: number;
  };
  return row.count;
}

export function upsertDimensions(db: DatabaseSync, rows: ActualRow[]): void {
  const month = db.prepare("insert or ignore into time_month (id) values (?)");
  for (const row of rows) {
    month.run(row.month);
    insertNamedDimensionIfMissing(db, "department", row.department, null);
    insertNamedDimensionIfMissing(db, "account", row.account, null);
  }
}

export function flattenDimensionNames(members: DimensionMember[]): string[] {
  return members.flatMap((member) => [member.name, ...flattenDimensionNames(member.children)]);
}

function propagateNewAccount(db: DatabaseSync, accountName: string): void {
  const months = db.prepare("select distinct id from time_month order by id").all() as {
    id: string;
  }[];
  const departments = db.prepare("select distinct name from department order by name").all() as {
    name: string;
  }[];
  const scenarios = db.prepare("select id from scenarios").all() as { id: string }[];

  const insertActual = db.prepare(
    "insert or ignore into actuals (month, department, account, value) values (?, ?, ?, 0)",
  );
  for (const month of months) {
    for (const dept of departments) {
      insertActual.run(month.id, dept.name, accountName);
    }
  }

  const insertFormula = db.prepare(
    "insert or ignore into scenario_formulas (scenario_id, account, formula) values (?, ?, 'base')",
  );
  for (const scenario of scenarios) {
    insertFormula.run(scenario.id, accountName);
  }

  recalculateAll(db);
}
