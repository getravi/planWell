import { DatabaseSync } from "node:sqlite";
import type { ScenarioAssumptions } from "../../domain/types.ts";
import { defaultScenarios } from "../sample-data.ts";
import { hashPassword } from "../security.ts";
import { ensureColumn, actualsVersionId } from "./utils.ts";
import type { ScenarioRow, LegacyScenarioRow } from "./utils.ts";
import { backfillDimensionOrder } from "./dimensions.ts";
import { replaceDriverAssumptions, backfillVersionOrder } from "./versions.ts";
import { countDriverAssumptionRows } from "./forecasts.ts";

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

export function seedDemoUser(db: DatabaseSync): void {
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
    if (countDriverAssumptionRows(db, row.id) === 0) {
      replaceDriverAssumptions(db, row.id, scenario);
    }
  }
  backfillVersionOrder(db);
}
