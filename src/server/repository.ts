import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { compareSeries, summarizeKpis } from "../domain/forecast.ts";
import { extractSymbolNames, validateFormula } from "../domain/formulaEngine.ts";
import { create, all } from "mathjs";
import type {
  ActualRow,
  CoreAccount,
  CustomVariableDef,
  DimensionImpact,
  DimensionKind,
  Dimensions,
  ForecastRow,
  KpiSummary,
  ScenarioAssumptions,
  ScenarioFormulas,
  VarianceRow,
} from "../domain/types.ts";
import { hashPassword } from "./security.ts";

import { migrate, seedDemoUser, seedEnvUser, ensureDefaultScenarios } from "./db/migrations.ts";

export function pruneExpiredSessions(db: DatabaseSync): void {
  db.prepare("delete from sessions where expires_at < ?").run(new Date().toISOString());
}
import {
  listNamedDimension,
  listTimeDimension,
  createDimensionMember,
  updateDimensionMember,
  getDimensionImpact,
  deleteDimensionMember,
  upsertDimensions,
  flattenDimensionNames,
} from "./db/dimensions.ts";
import {
  listVersions,
  createVersion,
  updateVersion,
  deleteVersion,
  readScenarios,
  readScenarioById,
  saveScenarioAssumptions,
  upsertScenario,
} from "./db/versions.ts";
import type { ScenarioRecord, VersionRecord } from "./db/versions.ts";
import { selectCubeRows, summarizeAccounts, summarizeDepartments } from "./db/actuals.ts";
import { recalculateScenario, recalculateAll } from "./db/forecasts.ts";
import { withTransaction } from "./db/utils.ts";
import type { UserRow } from "./db/utils.ts";
import { DimensionReferenceError } from "./db/dimensions.ts";
import {
  listCustomVariables as dbListCustomVariables,
  createCustomVariable as dbCreateCustomVariable,
  updateCustomVariable as dbUpdateCustomVariable,
  deleteCustomVariable as dbDeleteCustomVariable,
  validateCustomVariableFormula,
} from "./db/customVariables.ts";

export type { ScenarioRecord, VersionRecord };
export { DimensionReferenceError };

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
  getScenarioById(id: string): ScenarioRecord;
  saveScenarioAssumptions(assumptions: ScenarioAssumptions): ScenarioRecord;
  upsertScenario(assumptions: ScenarioAssumptions): ScenarioRecord;
  listVersions(): VersionRecord[];
  createVersion(name: string, sourceId: string): VersionRecord;
  updateVersion(id: string, changes: { name?: string; locked?: boolean }): VersionRecord;
  deleteVersion(id: string): void;
  recalculateScenario(name: string): void;
  recalculateAllScenarios(): void;
  compare(leftName: string, rightName: string): VarianceRow[];
  getMetricSummary(scenarioName?: string): MetricSummary;
  validateFormulaExpression(
    formula: string,
    account: string,
  ): { ok: true } | { ok: false; error: string };
  listCustomVariables(): CustomVariableDef[];
  createCustomVariable(def: CustomVariableDef): CustomVariableDef;
  updateCustomVariable(
    id: string,
    patch: { label?: string; formula?: string; sortOrder?: number; defaultValue?: number },
  ): CustomVariableDef;
  deleteCustomVariable(id: string): void;
  validateCustomVariableFormula(
    formula: string,
    availableIds: string[],
  ): { ok: true } | { ok: false; error: string };
  getSettings(): Record<string, string>;
  updateSettings(patch: Record<string, string>): void;
  backup(): Uint8Array;
  saveActualsFormulas(formulas: ScenarioFormulas): void;
  readActualsFormulas(): ScenarioFormulas;
};

export function createFileRepository(
  dbPath = process.env.SQLITE_PATH ?? resolve("data/planwell.sqlite"),
): Repository {
  mkdirSync(dirname(dbPath), { recursive: true });
  return createRepository(new DatabaseSync(dbPath));
}

export function createTestRepository(): Repository {
  return createRepository(new DatabaseSync(":memory:"));
}

function createRepository(db: DatabaseSync): Repository {
  migrate(db);
  seedDemoUser(db);
  seedEnvUser(db);
  pruneExpiredSessions(db);
  setInterval(() => pruneExpiredSessions(db), 60 * 60 * 1000);

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
      const rows = selectCubeRows(db, "actuals");
      const formulas = this.readActualsFormulas();
      if (Object.keys(formulas).length === 0) return rows;
      return applyActualsFormulas(rows, formulas);
    },
    listForecast(scenarioName) {
      if (!scenarioName) {
        return selectCubeRows(db, "forecast_values");
      }
      return db
        .prepare(`
        select forecast_values.month, forecast_values.department, forecast_values.account, forecast_values.value
        from forecast_values
        join versions on versions.id = forecast_values.scenario_id
        where versions.name = ?
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
    getScenarioById(id) {
      return readScenarioById(db, id);
    },
    saveScenarioAssumptions(assumptions) {
      return saveScenarioAssumptions(db, assumptions);
    },
    upsertScenario(assumptions) {
      return upsertScenario(db, assumptions);
    },
    listVersions() {
      return listVersions(db);
    },
    createVersion(name, sourceId) {
      return createVersion(db, name, sourceId);
    },
    updateVersion(id, changes) {
      return updateVersion(db, id, changes);
    },
    deleteVersion(id) {
      deleteVersion(db, id);
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
    validateFormulaExpression(formula, account) {
      const extraVars = Object.fromEntries(dbListCustomVariables(db).map((v) => [v.id, 1]));
      const accounts = flattenDimensionNames(listNamedDimension(db, "account"));
      for (const acc of accounts) {
        extraVars[acc] = 1;
      }
      return validateFormula(formula, account, extraVars);
    },
    listCustomVariables() {
      return dbListCustomVariables(db);
    },
    createCustomVariable(def) {
      return dbCreateCustomVariable(db, def);
    },
    updateCustomVariable(id, patch) {
      return dbUpdateCustomVariable(db, id, patch);
    },
    deleteCustomVariable(id) {
      dbDeleteCustomVariable(db, id);
    },
    validateCustomVariableFormula(formula, availableIds) {
      const allIds = [...new Set([...availableIds, ...dbListCustomVariables(db).map((v) => v.id)])];
      return validateCustomVariableFormula(formula, allIds);
    },
    getSettings() {
      const rows = db.prepare("select key, value from app_settings").all() as {
        key: string;
        value: string;
      }[];
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
    updateSettings(patch) {
      const upsert = db.prepare(
        "insert into app_settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
      );
      for (const [key, value] of Object.entries(patch)) {
        upsert.run(key, value);
      }
    },
    backup() {
      const dest = resolve(tmpdir(), `planwell-backup-${Date.now()}.sqlite`);
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
      const data = readFileSync(dest);
      unlinkSync(dest);
      return data;
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
    saveActualsFormulas(formulas) {
      const customVarSentinels = Object.fromEntries(
        dbListCustomVariables(db).map((v) => [v.id, 1]),
      );
      for (const [account, formula] of Object.entries(formulas)) {
        if (!formula) continue;
        const result = validateFormula(formula, account as CoreAccount, customVarSentinels);
        if (!result.ok) {
          throw new Error(`Invalid formula for ${account}: ${result.error}`);
        }
      }
      withTransaction(db, () => {
        db.prepare("delete from scenario_formulas where scenario_id = ?").run("actuals");
        for (const [account, formula] of Object.entries(formulas)) {
          if (formula) {
            db.prepare(
              "insert into scenario_formulas (scenario_id, account, formula) values (?, ?, ?)",
            ).run("actuals", account, formula);
          }
        }
      });
    },
    readActualsFormulas() {
      const rows = db
        .prepare("select account, formula from scenario_formulas where scenario_id = ?")
        .all("actuals") as { account: string; formula: string }[];
      const result: Record<string, string> = {};
      for (const row of rows) {
        result[row.account] = row.formula;
      }
      return result;
    },
  };
}

function applyActualsFormulas(rows: ActualRow[], formulas: ScenarioFormulas): ActualRow[] {
  const math = create(all);
  const rowMap = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const key = `${row.month}|${row.department}`;
    if (!rowMap.has(key)) {
      rowMap.set(key, new Map());
    }
    rowMap.get(key)!.set(row.account, row.value);
  }

  const result: ActualRow[] = [];
  for (const row of rows) {
    const key = `${row.month}|${row.department}`;
    const accountValues = rowMap.get(key)!;
    const formula = formulas[row.account];
    if (formula) {
      const deps = extractSymbolNames(formula);
      const ctx: Record<string, number> = {};
      for (const dep of deps) {
        ctx[dep] = accountValues.get(dep) ?? 0;
      }
      try {
        const value = math.evaluate(formula, ctx);
        if (typeof value === "number" && Number.isFinite(value)) {
          result.push({ ...row, value: Math.round(value * 100) / 100 });
        } else {
          result.push(row);
        }
      } catch {
        result.push(row);
      }
    } else {
      result.push(row);
    }
  }

  const formulaAccounts = Object.keys(formulas);
  const existingKeys = new Set(rows.map((r) => `${r.month}|${r.department}|${r.account}`));
  for (const account of formulaAccounts) {
    const formula = formulas[account];
    if (!formula) continue;
    for (const [key, accountValues] of rowMap) {
      const rowKey = `${key}|${account}`;
      if (!existingKeys.has(rowKey)) {
        const [month, department] = key.split("|");
        const deps = extractSymbolNames(formula);
        const ctx: Record<string, number> = {};
        for (const dep of deps) {
          ctx[dep] = accountValues.get(dep) ?? 0;
        }
        try {
          const value = math.evaluate(formula, ctx);
          if (typeof value === "number" && Number.isFinite(value)) {
            result.push({ month, department, account, value: Math.round(value * 100) / 100 });
          }
        } catch {
          // skip
        }
      }
    }
  }

  return result;
}
