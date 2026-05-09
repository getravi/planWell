import { DatabaseSync } from "node:sqlite";
import type { ForecastRow, ScenarioAssumptions } from "../../domain/types.ts";
import { buildForecast, nextMonths } from "../../domain/forecast.ts";
import { readScenarios, replaceDriverAssumptions, isVersionLocked } from "./versions.ts";
import { listNamedDimension } from "./dimensions.ts";
import { withTransaction } from "./utils.ts";
import { selectCubeRows } from "./actuals.ts";

export function countDriverAssumptionRows(db: DatabaseSync, scenarioId: string): number {
  const row = db
    .prepare("select count(*) as count from driver_assumptions where scenario_id = ?")
    .get(scenarioId) as { count: number };
  return row.count;
}

export function updateScenarioAssumptions(
  db: DatabaseSync,
  scenarioId: string,
  assumptions: ScenarioAssumptions,
): void {
  const now = new Date().toISOString();
  db.prepare("update scenarios set updated_at = ? where id = ?").run(now, scenarioId);
  db.prepare("update versions set updated_at = ? where id = ?").run(now, scenarioId);
  replaceDriverAssumptions(db, scenarioId, assumptions);
}

export function countScenarioOverrides(db: DatabaseSync, department: string): number {
  return readScenarios(db).filter((scenario) => scenario.assumptions.overrides[department]).length;
}

export function renameScenarioOverride(db: DatabaseSync, from: string, to: string): void {
  for (const scenario of readScenarios(db)) {
    if (isVersionLocked(db, scenario.id)) {
      continue;
    }
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

export function deleteScenarioOverride(db: DatabaseSync, department: string): void {
  for (const scenario of readScenarios(db)) {
    if (isVersionLocked(db, scenario.id)) {
      continue;
    }
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

export function recalculateAll(db: DatabaseSync): void {
  for (const scenario of readScenarios(db)) {
    if (isVersionLocked(db, scenario.id)) {
      continue;
    }
    recalculateScenario(db, scenario.name);
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
  const actualMonths = [...new Set(selectCubeRows(db, "actuals").map((row) => row.month))].sort();
  const lastActualMonth = actualMonths.at(-1);
  if (!lastActualMonth) {
    return [];
  }
  const explicitFutureMonths = (
    db.prepare("select id from time_month where id > ? order by id").all(lastActualMonth) as {
      id: string;
    }[]
  ).map((row) => row.id);
  return [...new Set([...nextMonths(lastActualMonth, 12), ...explicitFutureMonths])].sort();
}
