import { DatabaseSync } from "node:sqlite";
import { defaultScenarios } from "../sample-data.ts";
import { hashPassword } from "../security.ts";
import { ensureColumn, actualsVersionId, withTransaction } from "./utils.ts";
import type { ScenarioRow, LegacyScenarioRow } from "./utils.ts";
import { backfillDimensionOrder } from "./dimensions.ts";
import { backfillVersionOrder } from "./versions.ts";
import { replaceVarValues } from "./customVariables.ts";

export function migrate(db: DatabaseSync): void {
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
    create table if not exists versions (
      id text primary key,
      name text not null unique,
      kind text not null,
      locked integer not null default 0,
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
    create table if not exists scenario_formulas (
      scenario_id text not null,
      account text not null,
      formula text not null,
      primary key (scenario_id, account)
    );
    create table if not exists custom_variables (
      id text primary key,
      label text not null,
      kind text not null check(kind in ('input','calculated')),
      formula text,
      sort_order integer not null default 0
    );
    create table if not exists custom_variable_values (
      scenario_id text not null,
      var_id text not null,
      scope text not null,
      value real not null,
      primary key (scenario_id, var_id, scope)
    );
    create table if not exists app_settings (
      key text primary key,
      value text not null
    );
    create index if not exists actuals_cube_idx on actuals (month, department, account);
    create index if not exists driver_assumptions_lookup_idx on driver_assumptions (scenario_id, scope_type, scope_key, month);
    create index if not exists forecast_cube_idx on forecast_values (scenario_id, month, department, account);
  `);
  migrateLegacyScenarioAssumptions(db);
  migrateVersions(db);
  ensureColumn(db, "versions", "locked", "integer not null default 0");
  ensureColumn(db, "versions", "sort_order", "real");
  ensureColumn(db, "department", "parent_name", "text");
  ensureColumn(db, "account", "parent_name", "text");
  ensureColumn(db, "department", "sort_order", "real");
  ensureColumn(db, "account", "sort_order", "real");
  backfillDimensionOrder(db, "department");
  backfillDimensionOrder(db, "account");
  backfillVersionOrder(db);
  ensureColumn(db, "custom_variables", "default_value", "real");
  seedBuiltinVars(db);
  migrateDriverAssumptionsToVarValues(db);
  deleteStaleVarScopes(db);
}

export function migrateVersions(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(`
    insert into versions (id, name, kind, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(id) do nothing
  `).run(actualsVersionId, "Actuals", "actuals", now, now);

  const insertScenarioVersion = db.prepare(`
    insert into versions (id, name, kind, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(id) do nothing
  `);
  const scenarioRows = db
    .prepare("select id, name, created_at, updated_at from scenarios")
    .all() as (ScenarioRow & { created_at: string })[];
  for (const row of scenarioRows) {
    insertScenarioVersion.run(row.id, row.name, "scenario", row.created_at, row.updated_at);
  }
}

export function migrateLegacyScenarioAssumptions(db: DatabaseSync): void {
  const columns = db.prepare("pragma table_info(scenarios)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "assumptions_json")) {
    return;
  }

  withTransaction(db, () => {
    const legacyRows = db.prepare("select * from scenarios").all() as LegacyScenarioRow[];
    for (const row of legacyRows) {
      const old = JSON.parse(row.assumptions_json) as {
        name: string;
        overrides?: Record<string, { monthly?: Record<string, Record<string, number>> }>;
      };
      replaceVarValues(db, row.id, {
        name: old.name,
        varOverrides: Object.fromEntries(
          Object.entries(old.overrides ?? {}).map(([dept, ov]) => [
            dept,
            { monthly: ov.monthly },
          ]),
        ),
      });
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
  });
}

function seedBuiltinVars(db: DatabaseSync): void {
  const builtins = [
    { id: "revenueGrowthRate", label: "Revenue Growth Rate", sort_order: 10, default_value: 0.03 },
    { id: "cogsPctOfRevenue", label: "COGS % of Revenue", sort_order: 20, default_value: 0.44 },
    { id: "headcountGrowthRate", label: "Headcount Growth Rate", sort_order: 30, default_value: 0.02 },
    { id: "costPerHead", label: "Cost per Head", sort_order: 40, default_value: 18000 },
  ];
  const insert = db.prepare(
    "insert or ignore into custom_variables (id, label, kind, formula, sort_order, default_value) values (?, ?, 'input', null, ?, ?)",
  );
  const setDefault = db.prepare(
    "update custom_variables set default_value = ? where id = ? and default_value is null",
  );
  for (const v of builtins) {
    insert.run(v.id, v.label, v.sort_order, v.default_value);
    setDefault.run(v.default_value, v.id);
  }
}

function migrateDriverAssumptionsToVarValues(db: DatabaseSync): void {
  const driverRows = db.prepare(`
    select scenario_id, scope_type, scope_key, month, driver_key, value
    from driver_assumptions
    where driver_key in ('revenueGrowthRate', 'cogsPctOfRevenue', 'headcountGrowthRate', 'costPerHead')
  `).all() as { scenario_id: string; scope_type: string; scope_key: string; month: string; driver_key: string; value: number }[];

  const insert = db.prepare(`
    insert or ignore into custom_variable_values (scenario_id, var_id, scope, value)
    values (?, ?, ?, ?)
  `);

  for (const row of driverRows) {
    let scope: string;
    if (row.scope_type === "global" && row.month === "__all__") {
      scope = "global";
    } else if (row.scope_type === "global") {
      scope = `monthly:${row.month}`;
    } else if (row.scope_type === "department" && row.month === "__all__") {
      scope = `dept:${row.scope_key}`;
    } else {
      scope = `dept:${row.scope_key}:monthly:${row.month}`;
    }
    insert.run(row.scenario_id, row.driver_key, scope, row.value);
  }
}

function deleteStaleVarScopes(db: DatabaseSync): void {
  db.prepare(`
    delete from custom_variable_values
    where scope not like 'dept:%:monthly:%'
  `).run();
}

export function seedDemoUser(db: DatabaseSync): void {
  if (process.env.PLANWELL_SKIP_SEED === "1") {
    return;
  }
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

export function seedEnvUser(db: DatabaseSync): void {
  const email = process.env.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD;
  if (!email || !password) return;
  const exists = db.prepare("select id from users where email = ?").get(email.toLowerCase());
  if (exists) return;
  db.prepare("insert into users (id, email, password_hash, created_at) values (?, ?, ?, ?)").run(
    crypto.randomUUID(),
    email.toLowerCase(),
    hashPassword.create(password),
    new Date().toISOString(),
  );
  console.log(`[seed] created user: ${email}`);
}

export function ensureDefaultScenarios(db: DatabaseSync): void {
  const insertVersion = db.prepare(`
    insert into versions (id, name, kind, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(name) do nothing
  `);
  const insertScenario = db.prepare(`
    insert into scenarios (id, name, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(name) do nothing
  `);
  for (const scenario of defaultScenarios) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    insertVersion.run(id, scenario.name, "scenario", now, now);
    const version = db.prepare("select id from versions where name = ?").get(scenario.name) as {
      id: string;
    };
    insertScenario.run(version.id, scenario.name, now, now);
    const row = db.prepare("select id from scenarios where name = ?").get(scenario.name) as {
      id: string;
    };
    const hasValues = (db.prepare("select count(*) as cnt from custom_variable_values where scenario_id = ?").get(row.id) as { cnt: number }).cnt > 0;
    if (!hasValues) {
      replaceVarValues(db, row.id, scenario);
    }
  }
  backfillVersionOrder(db);
}
