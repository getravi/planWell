import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildForecast, compareSeries, summarizeKpis } from "../domain/forecast.ts";
import type {
  ActualRow,
  DimensionImpact,
  DimensionKind,
  DimensionMember,
  Dimensions,
  DriverAssumptions,
  ForecastRow,
  KpiSummary,
  ScenarioAssumptions,
  VarianceRow,
} from "../domain/types.ts";
import { defaultScenarios } from "./sample-data.ts";
import { hashPassword } from "./security.ts";

export type ScenarioRecord = {
  id: string;
  name: string;
  assumptions: ScenarioAssumptions;
  updatedAt: string;
};

export type MetricCitation = {
  tool: string;
  label: string;
  value: number | string;
};

export type MetricSummary = {
  kpis: KpiSummary;
  accounts: {
    account: string;
    value: number;
  }[];
  departments: {
    department: string;
    revenue: number;
    cogs: number;
    opex: number;
    headcount: number;
  }[];
  months: string[];
};

export type Repository = {
  verifyUser(email: string, password: string): { id: string; email: string } | null;
  createSession(userId: string): string;
  getSession(sessionId: string): { userId: string; email: string } | null;
  deleteSession(sessionId: string): void;
  replaceActuals(rows: ActualRow[]): void;
  listActuals(): ActualRow[];
  listForecast(scenarioName?: string): ForecastRow[];
  listDimensions(): Dimensions;
  createDimensionMember(kind: DimensionKind, name: string, parentName?: string | null): void;
  updateDimensionMember(
    kind: DimensionKind,
    name: string,
    changes: { name?: string; parentName?: string | null; sortOrder?: number },
  ): void;
  getDimensionImpact(kind: DimensionKind, name: string): DimensionImpact;
  deleteDimensionMember(kind: DimensionKind, name: string, force: boolean): DimensionImpact;
  listScenarios(): ScenarioRecord[];
  upsertScenario(assumptions: ScenarioAssumptions): ScenarioRecord;
  recalculateScenario(name: string): void;
  recalculateAllScenarios(): void;
  compare(leftName: string, rightName: string): VarianceRow[];
  getMetricSummary(scenarioName?: string): MetricSummary;
};

type UserRow = { id: string; email: string; password_hash: string };
type ScenarioRow = { id: string; name: string; updated_at: string };
type LegacyScenarioRow = ScenarioRow & {
  assumptions_json: string;
  created_at: string;
};
type DriverAssumptionRow = {
  scenario_id: string;
  scope_type: string;
  scope_key: string;
  month: string;
  driver_key: string;
  value: number;
};
type DimensionRow = { name: string; parent_name: string | null; sort_order?: number | null };

const allMonths = "__all__";
const globalScopeKey = "__global__";
const driverKeys = [
  "revenueGrowthRate",
  "cogsPctOfRevenue",
  "headcountGrowthRate",
  "costPerHead",
] as const;
type DriverKey = (typeof driverKeys)[number];

export function createFileRepository(dbPath = resolve("data/planwell.sqlite")): Repository {
  mkdirSync(dirname(dbPath), { recursive: true });
  return createRepository(new DatabaseSync(dbPath));
}

export function createTestRepository(): Repository {
  return createRepository(new DatabaseSync(":memory:"));
}

function createRepository(db: DatabaseSync): Repository {
  migrate(db);
  seedDemoUser(db);

  return {
    verifyUser(email, password) {
      const user = db.prepare("select * from users where email = ?").get(email.toLowerCase()) as
        | UserRow
        | undefined;
      if (!user) {
        return null;
      }
      return hashPassword.verify(password, user.password_hash)
        ? { id: user.id, email: user.email }
        : null;
    },
    createSession(userId) {
      const id = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 8).toISOString();
      db.prepare("insert into sessions (id, user_id, expires_at) values (?, ?, ?)").run(
        id,
        userId,
        expiresAt,
      );
      return id;
    },
    getSession(sessionId) {
      const session = db
        .prepare(`
        select sessions.user_id as userId, users.email as email
        from sessions
        join users on users.id = sessions.user_id
        where sessions.id = ? and sessions.expires_at > ?
      `)
        .get(sessionId, new Date().toISOString()) as { userId: string; email: string } | undefined;
      return session ?? null;
    },
    deleteSession(sessionId) {
      db.prepare("delete from sessions where id = ?").run(sessionId);
    },
    replaceActuals(rows) {
      withTransaction(db, () => {
        db.prepare("delete from actuals").run();
        upsertDimensions(db, rows);
        const insert = db.prepare(
          "insert into actuals (month, department, account, value) values (?, ?, ?, ?)",
        );
        for (const row of rows) {
          insert.run(row.month, row.department, row.account, row.value);
        }
      });
      ensureDefaultScenarios(db);
      recalculateAll(db);
    },
    listActuals() {
      return selectCubeRows(db, "actuals");
    },
    listForecast(scenarioName) {
      if (!scenarioName) {
        return selectCubeRows(db, "forecast_values");
      }
      return db
        .prepare(`
        select forecast_values.month, forecast_values.department, forecast_values.account, forecast_values.value
        from forecast_values
        join scenarios on scenarios.id = forecast_values.scenario_id
        where scenarios.name = ?
        order by forecast_values.month, forecast_values.department, forecast_values.account
      `)
        .all(scenarioName) as ForecastRow[];
    },
    listDimensions() {
      return {
        department: listNamedDimension(db, "department"),
        account: listNamedDimension(db, "account"),
        time: listTimeDimension(db),
      };
    },
    createDimensionMember(kind, name, parentName = null) {
      createDimensionMember(db, kind, name, parentName);
    },
    updateDimensionMember(kind, name, changes) {
      updateDimensionMember(db, kind, name, changes);
    },
    getDimensionImpact(kind, name) {
      return getDimensionImpact(db, kind, name);
    },
    deleteDimensionMember(kind, name, force) {
      return deleteDimensionMember(db, kind, name, force);
    },
    listScenarios() {
      return readScenarios(db);
    },
    upsertScenario(assumptions) {
      const existing = db
        .prepare("select id from scenarios where name = ?")
        .get(assumptions.name) as { id: string } | undefined;
      const id = existing?.id ?? crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        insert into scenarios (id, name, created_at, updated_at)
        values (?, ?, ?, ?)
        on conflict(name) do update set updated_at = excluded.updated_at
      `).run(id, assumptions.name, now, now);
      replaceDriverAssumptions(db, id, assumptions);
      recalculateScenario(db, assumptions.name);
      return readScenarios(db).find((scenario) => scenario.name === assumptions.name)!;
    },
    recalculateScenario(name) {
      recalculateScenario(db, name);
    },
    recalculateAllScenarios() {
      recalculateAll(db);
    },
    compare(leftName, rightName) {
      return compareSeries(this.listForecast(leftName), this.listForecast(rightName));
    },
    getMetricSummary(scenarioName) {
      const rows = scenarioName ? this.listForecast(scenarioName) : this.listActuals();
      return {
        kpis: summarizeKpis(rows),
        accounts: summarizeAccounts(db, rows),
        departments: summarizeDepartments(db, rows),
        months: [...new Set(rows.map((row) => row.month))].sort(),
      };
    },
  };
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    create table if not exists time_month (id text primary key);
    create table if not exists department (name text primary key, parent_name text, sort_order real);
    create table if not exists account (name text primary key, parent_name text, sort_order real);
    create table if not exists users (id text primary key, email text not null unique, password_hash text not null, created_at text not null);
    create table if not exists sessions (id text primary key, user_id text not null, expires_at text not null);
    create table if not exists actuals (
      month text not null,
      department text not null,
      account text not null,
      value real not null
    );
    create table if not exists scenarios (
      id text primary key,
      name text not null unique,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists driver_assumptions (
      scenario_id text not null,
      scope_type text not null,
      scope_key text not null,
      month text not null,
      driver_key text not null,
      value real not null,
      primary key (scenario_id, scope_type, scope_key, month, driver_key)
    );
    create table if not exists forecast_values (
      scenario_id text not null,
      month text not null,
      department text not null,
      account text not null,
      value real not null
    );
    create index if not exists actuals_cube_idx on actuals (month, department, account);
    create index if not exists driver_assumptions_lookup_idx on driver_assumptions (scenario_id, scope_type, scope_key, month);
    create index if not exists forecast_cube_idx on forecast_values (scenario_id, month, department, account);
  `);
  migrateLegacyScenarioAssumptions(db);
  ensureColumn(db, "department", "parent_name", "text");
  ensureColumn(db, "account", "parent_name", "text");
  ensureColumn(db, "department", "sort_order", "real");
  ensureColumn(db, "account", "sort_order", "real");
  backfillDimensionOrder(db, "department");
  backfillDimensionOrder(db, "account");
}

function migrateLegacyScenarioAssumptions(db: DatabaseSync): void {
  const columns = db.prepare("pragma table_info(scenarios)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "assumptions_json")) {
    return;
  }

  const legacyRows = db.prepare("select * from scenarios").all() as LegacyScenarioRow[];
  for (const row of legacyRows) {
    replaceDriverAssumptions(db, row.id, JSON.parse(row.assumptions_json) as ScenarioAssumptions);
  }

  db.exec(`
    alter table scenarios rename to scenarios_legacy;
    create table scenarios (
      id text primary key,
      name text not null unique,
      created_at text not null,
      updated_at text not null
    );
    insert into scenarios (id, name, created_at, updated_at)
    select id, name, created_at, updated_at from scenarios_legacy;
    drop table scenarios_legacy;
  `);
}

function ensureColumn(db: DatabaseSync, table: string, column: string, type: string): void {
  const columns = db.prepare(`pragma table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) {
    db.exec(`alter table ${table} add column ${column} ${type}`);
  }
}

function countDriverAssumptionRows(db: DatabaseSync, scenarioId: string): number {
  const row = db
    .prepare("select count(*) as count from driver_assumptions where scenario_id = ?")
    .get(scenarioId) as { count: number };
  return row.count;
}

function updateScenarioAssumptions(
  db: DatabaseSync,
  scenarioId: string,
  assumptions: ScenarioAssumptions,
): void {
  db.prepare("update scenarios set updated_at = ? where id = ?").run(
    new Date().toISOString(),
    scenarioId,
  );
  replaceDriverAssumptions(db, scenarioId, assumptions);
}

function replaceDriverAssumptions(
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

function readDriverAssumptions(db: DatabaseSync, scenario: ScenarioRow): ScenarioAssumptions {
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

function isDriverKey(value: string): value is DriverKey {
  return driverKeys.includes(value as DriverKey);
}

function seedDemoUser(db: DatabaseSync): void {
  const exists = db.prepare("select id from users where email = ?").get("director@planwell.local");
  if (exists) {
    return;
  }
  db.prepare("insert into users (id, email, password_hash, created_at) values (?, ?, ?, ?)").run(
    crypto.randomUUID(),
    "director@planwell.local",
    hashPassword.create("planwell-demo"),
    new Date().toISOString(),
  );
}

function ensureDefaultScenarios(db: DatabaseSync): void {
  const insert = db.prepare(`
    insert into scenarios (id, name, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(name) do nothing
  `);
  for (const scenario of defaultScenarios) {
    const now = new Date().toISOString();
    insert.run(crypto.randomUUID(), scenario.name, now, now);
    const row = db.prepare("select id from scenarios where name = ?").get(scenario.name) as {
      id: string;
    };
    if (countDriverAssumptionRows(db, row.id) === 0) {
      replaceDriverAssumptions(db, row.id, scenario);
    }
  }
}

function upsertDimensions(db: DatabaseSync, rows: ActualRow[]): void {
  const month = db.prepare("insert or ignore into time_month (id) values (?)");
  for (const row of rows) {
    month.run(row.month);
    insertNamedDimensionIfMissing(db, "department", row.department, null);
    insertNamedDimensionIfMissing(db, "account", row.account, null);
  }
}

function createDimensionMember(
  db: DatabaseSync,
  kind: DimensionKind,
  rawName: string,
  rawParentName: string | null,
): void {
  const name = normalizeDimensionName(kind, rawName);
  if (kind === "time") {
    ensureTimeName(name);
    if (dimensionExists(db, kind, name)) {
      throw new Error(`${name} already exists.`);
    }
    db.prepare("insert into time_month (id) values (?)").run(name);
    return;
  }

  const parentName = normalizeOptionalName(rawParentName);
  ensureNamedDimensionCanSave(db, kind, name, parentName, null);
  insertNamedDimensionIfMissing(db, kind, name, parentName);
}

function updateDimensionMember(
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

function updateTimeMember(db: DatabaseSync, currentName: string, nextName: string): void {
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

function getDimensionImpact(
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

function deleteDimensionMember(
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

function listNamedDimension(db: DatabaseSync, kind: "department" | "account"): DimensionMember[] {
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

function listTimeDimension(db: DatabaseSync): DimensionMember[] {
  const months = (
    db.prepare("select id from time_month order by id").all() as { id: string }[]
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

function sortDimensionTree(members: DimensionMember[]): void {
  members.sort(
    (left, right) =>
      (left.sortOrder ?? Number.POSITIVE_INFINITY) -
        (right.sortOrder ?? Number.POSITIVE_INFINITY) || left.name.localeCompare(right.name),
  );
  for (const member of members) {
    sortDimensionTree(member.children);
  }
}

function ensureNamedDimensionCanSave(
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

function insertNamedDimensionIfMissing(
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

function nextSortOrder(
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

function normalizeSiblingOrder(
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

function backfillDimensionOrder(db: DatabaseSync, kind: "department" | "account"): void {
  const table = dimensionTable(kind);
  const rows = db.prepare(`select name, parent_name, sort_order from ${table}`).all() as
    | DimensionRow[]
    | [];
  const parentNames = new Set<string | null>(rows.map((row) => row.parent_name));
  for (const parentName of parentNames) {
    normalizeSiblingOrder(db, kind, parentName);
  }
}

function getNamedDimensionRow(
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

function getDescendants(db: DatabaseSync, kind: "department" | "account", name: string): string[] {
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

function dimensionExists(db: DatabaseSync, kind: DimensionKind, name: string): boolean {
  const table = kind === "time" ? "time_month" : dimensionTable(kind);
  const column = kind === "time" ? "id" : "name";
  return Boolean(db.prepare(`select ${column} from ${table} where ${column} = ?`).get(name));
}

function dimensionTable(kind: "department" | "account"): string {
  return kind;
}

function normalizeDimensionName(kind: DimensionKind, value: string): string {
  const name = value.trim();
  if (!name) {
    throw new Error(`${kind} name is required.`);
  }
  if (kind === "time") {
    ensureTimeName(name);
  }
  return name;
}

function normalizeOptionalName(value: string | null | undefined): string | null {
  const name = value?.trim();
  return name ? name : null;
}

function ensureTimeName(name: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(name)) {
    throw new Error("Time members must use YYYY-MM.");
  }
}

function getReferenceCount(db: DatabaseSync, kind: DimensionKind, name: string): number {
  const column = kind === "time" ? "month" : kind;
  return countRows(db, "actuals", column, name) + countRows(db, "forecast_values", column, name);
}

function countRows(
  db: DatabaseSync,
  table: "actuals" | "forecast_values",
  column: "month" | "department" | "account",
  value: string,
): number {
  const row = db
    .prepare(`select count(*) as count from ${table} where ${column} = ?`)
    .get(value) as {
    count: number;
  };
  return row.count;
}

function countChildren(db: DatabaseSync, kind: "department" | "account", name: string): number {
  const table = dimensionTable(kind);
  const row = db
    .prepare(`select count(*) as count from ${table} where parent_name = ?`)
    .get(name) as {
    count: number;
  };
  return row.count;
}

function countScenarioOverrides(db: DatabaseSync, department: string): number {
  return readScenarios(db).filter((scenario) => scenario.assumptions.overrides[department]).length;
}

function renameScenarioOverride(db: DatabaseSync, from: string, to: string): void {
  for (const scenario of readScenarios(db)) {
    const override = scenario.assumptions.overrides[from];
    if (!override) {
      continue;
    }
    const nextOverrides = { ...scenario.assumptions.overrides };
    delete nextOverrides[from];
    nextOverrides[to] = override;
    updateScenarioAssumptions(db, scenario.id, {
      ...scenario.assumptions,
      overrides: nextOverrides,
    });
  }
}

function deleteScenarioOverride(db: DatabaseSync, department: string): void {
  for (const scenario of readScenarios(db)) {
    if (!scenario.assumptions.overrides[department]) {
      continue;
    }
    const nextOverrides = { ...scenario.assumptions.overrides };
    delete nextOverrides[department];
    updateScenarioAssumptions(db, scenario.id, {
      ...scenario.assumptions,
      overrides: nextOverrides,
    });
  }
}

function recalculateAll(db: DatabaseSync): void {
  for (const scenario of readScenarios(db)) {
    recalculateScenario(db, scenario.name);
  }
}

function recalculateScenario(db: DatabaseSync, name: string): void {
  const scenario = readScenarios(db).find((item) => item.name === name);
  if (!scenario) {
    throw new Error(`Scenario not found: ${name}`);
  }
  const forecast = buildForecast(
    selectCubeRows(db, "actuals"),
    scenario.assumptions,
    listNamedDimension(db, "department"),
  );
  withTransaction(db, () => {
    db.prepare("delete from forecast_values where scenario_id = ?").run(scenario.id);
    const insert = db.prepare(
      "insert into forecast_values (scenario_id, month, department, account, value) values (?, ?, ?, ?, ?)",
    );
    for (const row of forecast) {
      insert.run(scenario.id, row.month, row.department, row.account, row.value);
    }
  });
}

function readScenarios(db: DatabaseSync): ScenarioRecord[] {
  return (db.prepare("select * from scenarios order by name").all() as ScenarioRow[])
    .map((row) => ({
      id: row.id,
      name: row.name,
      assumptions: readDriverAssumptions(db, row),
      updatedAt: row.updated_at,
    }))
    .sort(
      (left, right) =>
        scenarioOrder(left.name) - scenarioOrder(right.name) || left.name.localeCompare(right.name),
    );
}

function scenarioOrder(name: string): number {
  return ["Base Case", "Aggressive Growth", "Conservative"].indexOf(name) === -1
    ? 99
    : ["Base Case", "Aggressive Growth", "Conservative"].indexOf(name);
}

function selectCubeRows(db: DatabaseSync, table: "actuals" | "forecast_values"): ActualRow[] {
  return db
    .prepare(
      `select month, department, account, value from ${table} order by month, department, account`,
    )
    .all() as ActualRow[];
}

function sum(rows: ActualRow[], account: string): number {
  return (
    Math.round(
      rows.filter((row) => row.account === account).reduce((total, row) => total + row.value, 0) *
        100,
    ) / 100
  );
}

function summarizeDepartments(
  db: DatabaseSync,
  rows: ActualRow[],
): {
  department: string;
  revenue: number;
  cogs: number;
  opex: number;
  headcount: number;
}[] {
  const dimensionNames = flattenDimensionNames(listNamedDimension(db, "department"));
  const rowDepartments = new Set(rows.map((row) => row.department));
  const knownDepartments = new Set(dimensionNames);
  const names = [
    ...dimensionNames,
    ...[...rowDepartments]
      .filter((department) => !knownDepartments.has(department))
      .sort((left, right) => left.localeCompare(right)),
  ];

  return names
    .map((department) => {
      const descendants = getDescendants(db, "department", department);
      const scopedNames = new Set([department, ...descendants]);
      const scoped = rows.filter((row) => scopedNames.has(row.department));
      return {
        department,
        revenue: sum(scoped, "Revenue"),
        cogs: sum(scoped, "COGS"),
        opex: sum(scoped, "OpEx"),
        headcount: sum(scoped, "Headcount"),
      };
    })
    .filter(
      (department) =>
        department.revenue !== 0 ||
        department.cogs !== 0 ||
        department.opex !== 0 ||
        department.headcount !== 0,
    );
}

function summarizeAccounts(
  db: DatabaseSync,
  rows: ActualRow[],
): {
  account: string;
  value: number;
}[] {
  const dimensionNames = flattenDimensionNames(listNamedDimension(db, "account"));
  const rowAccounts = new Set(rows.map((row) => row.account));
  const knownAccounts = new Set(dimensionNames);
  const names = [
    ...dimensionNames,
    ...[...rowAccounts]
      .filter((account) => !knownAccounts.has(account))
      .sort((left, right) => left.localeCompare(right)),
  ];

  return names
    .map((account) => {
      const descendants = getDescendants(db, "account", account);
      const scopedNames = new Set([account, ...descendants]);
      const value = sumAll(rows.filter((row) => scopedNames.has(row.account)));
      return { account, value };
    })
    .filter((account) => account.value !== 0);
}

function sumAll(rows: ActualRow[]): number {
  return Math.round(rows.reduce((total, row) => total + row.value, 0) * 100) / 100;
}

function flattenDimensionNames(members: DimensionMember[]): string[] {
  return members.flatMap((member) => [member.name, ...flattenDimensionNames(member.children)]);
}

function withTransaction(db: DatabaseSync, work: () => void): void {
  db.exec("begin");
  try {
    work();
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}
