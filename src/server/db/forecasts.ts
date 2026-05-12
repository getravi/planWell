import { DatabaseSync } from "node:sqlite";
import type { ForecastRow, ScenarioAssumptions } from "../../domain/types.ts";
import { buildForecast, nextMonths } from "../../domain/forecast.ts";
import { readScenarios, isVersionLocked } from "./versions.ts";
import { listNamedDimension } from "./dimensions.ts";
import { withTransaction } from "./utils.ts";
import { selectCubeRows } from "./actuals.ts";
import { listCustomVariables, replaceVarValues } from "./customVariables.ts";
import { logger } from "../../logger.ts";

export function updateScenarioAssumptions(
  db: DatabaseSync,
  scenarioId: string,
  assumptions: ScenarioAssumptions,
): void {
  const now = new Date().toISOString();
  db.prepare("update scenarios set updated_at = ? where id = ?").run(now, scenarioId);
  db.prepare("update versions set updated_at = ? where id = ?").run(now, scenarioId);
  replaceVarValues(db, scenarioId, assumptions);
}

export function countScenarioOverrides(db: DatabaseSync, department: string): number {
  return readScenarios(db).filter((scenario) => scenario.assumptions.varOverrides?.[department]).length;
}

export function renameScenarioOverride(db: DatabaseSync, from: string, to: string): void {
  for (const scenario of readScenarios(db)) {
    if (isVersionLocked(db, scenario.id)) {
      continue;
    }
    const override = scenario.assumptions.varOverrides?.[from];
    if (!override) {
      continue;
    }
    const nextOverrides = { ...scenario.assumptions.varOverrides };
    delete nextOverrides[from];
    nextOverrides[to] = override;
    updateScenarioAssumptions(db, scenario.id, {
      ...scenario.assumptions,
      varOverrides: nextOverrides,
    });
  }
}

export function deleteScenarioOverride(db: DatabaseSync, department: string): void {
  for (const scenario of readScenarios(db)) {
    if (isVersionLocked(db, scenario.id)) {
      continue;
    }
    if (!scenario.assumptions.varOverrides?.[department]) {
      continue;
    }
    const nextOverrides = { ...scenario.assumptions.varOverrides };
    delete nextOverrides[department];
    updateScenarioAssumptions(db, scenario.id, {
      ...scenario.assumptions,
      varOverrides: nextOverrides,
    });
  }
}

export function recalculateAll(db: DatabaseSync): void {
  const errors: { name: string; message: string }[] = [];
  for (const scenario of readScenarios(db)) {
    if (isVersionLocked(db, scenario.id)) {
      continue;
    }
    try {
      recalculateScenario(db, scenario.name);
    } catch (err) {
      errors.push({
        name: scenario.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (errors.length > 0) {
    logger.error({ errors }, "recalc.all.partial-failure");
  }
}

export function recalculateScenario(db: DatabaseSync, name: string): void {
  const scenario = readScenarios(db).find((item) => item.name === name);
  if (!scenario) {
    throw new Error(`Scenario not found: ${name}`);
  }
  if (isVersionLocked(db, scenario.id)) {
    throw new Error(`${scenario.name} is locked and cannot be edited.`);
  }
  const forecast = buildForecast(
    selectCubeRows(db, "actuals"),
    scenario.assumptions,
    listNamedDimension(db, "department"),
    listPlanningForecastMonths(db),
    listCustomVariables(db),
  );
  withTransaction(db, () => {
    db.prepare("delete from forecast_values where scenario_id = ?").run(scenario.id);
    insertForecastRows(db, scenario.id, forecast);
  });
}

export function selectForecastRowsByScenarioId(
  db: DatabaseSync,
  scenarioId: string,
): ForecastRow[] {
  return db
    .prepare(
      "select month, department, account, value from forecast_values where scenario_id = ? order by month, department, account",
    )
    .all(scenarioId) as ForecastRow[];
}

export function insertForecastRows(
  db: DatabaseSync,
  scenarioId: string,
  rows: ForecastRow[],
): void {
  const insert = db.prepare(
    "insert into forecast_values (scenario_id, month, department, account, value) values (?, ?, ?, ?, ?)",
  );
  for (const row of rows) {
    insert.run(scenarioId, row.month, row.department, row.account, row.value);
  }
}

export function listPlanningForecastMonths(db: DatabaseSync): string[] {
  const monthRows = db
    .prepare("select distinct month from actuals order by month")
    .all() as { month: string }[];
  const lastActualMonth = monthRows.at(-1)?.month;
  if (!lastActualMonth) {
    return [];
  }
  const horizon = getForecastHorizon(db);
  const explicitFutureMonths = (
    db.prepare("select id from time_month where id > ? order by id").all(lastActualMonth) as {
      id: string;
    }[]
  ).map((row) => row.id);
  return [...new Set([...nextMonths(lastActualMonth, horizon), ...explicitFutureMonths])].sort();
}

function getForecastHorizon(db: DatabaseSync): number {
  try {
    const row = db.prepare("select value from app_settings where key = 'forecastHorizon'").get() as { value: string } | undefined;
    if (!row) return 12;
    const n = parseInt(row.value, 10);
    return Number.isFinite(n) && n >= 1 && n <= 60 ? n : 12;
  } catch {
    return 12;
  }
}
