import { DatabaseSync } from "node:sqlite";

export type UserRow = { id: string; email: string; password_hash: string };

export type ScenarioRow = { id: string; name: string; updated_at: string };

export type VersionRow = {
  id: string;
  name: string;
  kind: "actuals" | "scenario";
  locked: number;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

export type LegacyScenarioRow = ScenarioRow & {
  assumptions_json: string;
  created_at: string;
};

export type DriverAssumptionRow = {
  scenario_id: string;
  scope_type: string;
  scope_key: string;
  month: string;
  driver_key: string;
  value: number;
};

export type DimensionRow = { name: string; parent_name: string | null; sort_order?: number | null };

export const allMonths = "__all__";

export const actualsVersionId = "actuals";

export const globalScopeKey = "__global__";

export const driverKeys = [
  "revenueGrowthRate",
  "cogsPctOfRevenue",
  "headcountGrowthRate",
  "costPerHead",
] as const;

export type DriverKey = (typeof driverKeys)[number];

export function withTransaction(db: DatabaseSync, work: () => void): void {
  db.exec("begin");
  try {
    work();
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

export function ensureColumn(db: DatabaseSync, table: string, column: string, type: string): void {
  const columns = db.prepare(`pragma table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) {
    db.exec(`alter table ${table} add column ${column} ${type}`);
  }
}
