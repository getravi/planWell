import { DatabaseSync } from "node:sqlite";
import type { CustomVariableDef, CustomVarValues, ScenarioAssumptions } from "../../domain/types.ts";
import { topoSortCustomVars, validateCustomFormula, CycleError } from "../../domain/formulaEngine.ts";

const RESERVED_IDS = new Set([
  "base", "growthRate", "cogsPct", "costPerHead", "month", "revenue", "headcount",
  "pow", "sqrt", "abs", "max", "min", "round", "pi", "e", "true", "false", "NaN", "Infinity",
  "revenueGrowthRate", "cogsPctOfRevenue", "headcountGrowthRate",
]);

const ID_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type CustomVariableRow = {
  id: string;
  label: string;
  kind: string;
  formula: string | null;
  sort_order: number;
};

export function listCustomVariables(db: DatabaseSync): CustomVariableDef[] {
  const rows = db
    .prepare("select id, label, kind, formula, sort_order from custom_variables order by sort_order, id")
    .all() as CustomVariableRow[];
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    kind: row.kind as "input" | "calculated",
    formula: row.formula ?? undefined,
  }));
}

export function createCustomVariable(db: DatabaseSync, def: CustomVariableDef): CustomVariableDef {
  if (!ID_PATTERN.test(def.id)) {
    throw new Error(`"${def.id}" is not a valid identifier. Use letters, digits, and underscores only.`);
  }
  if (RESERVED_IDS.has(def.id)) {
    throw new Error(`"${def.id}" is a reserved identifier.`);
  }
  const existing = db.prepare("select id from custom_variables where id = ?").get(def.id);
  if (existing) {
    throw new Error(`Variable "${def.id}" already exists.`);
  }
  if (def.kind === "calculated") {
    if (!def.formula) {
      throw new Error("Calculated variables require a formula.");
    }
    const existingIds = listCustomVariables(db).map((v) => v.id);
    const result = validateCustomFormula(def.formula, existingIds);
    if (!result.ok) {
      throw new Error(`Invalid formula: ${result.error}`);
    }
    try {
      topoSortCustomVars([...listCustomVariables(db), def]);
    } catch (err) {
      if (err instanceof CycleError) {
        throw new Error("This formula creates a cycle in variable dependencies.");
      }
    }
  }
  const sortOrder =
    ((db.prepare("select coalesce(max(sort_order), 0) as m from custom_variables").get() as { m: number }).m) + 10;
  db.prepare(
    "insert into custom_variables (id, label, kind, formula, sort_order) values (?, ?, ?, ?, ?)",
  ).run(def.id, def.label, def.kind, def.formula ?? null, sortOrder);
  return listCustomVariables(db).find((v) => v.id === def.id)!;
}

export function updateCustomVariable(
  db: DatabaseSync,
  id: string,
  patch: { label?: string; formula?: string; sortOrder?: number },
): CustomVariableDef {
  const existing = db.prepare("select id, kind from custom_variables where id = ?").get(id) as
    | { id: string; kind: string }
    | undefined;
  if (!existing) {
    throw new Error(`Variable "${id}" not found.`);
  }
  if (patch.formula !== undefined) {
    if (existing.kind !== "calculated") {
      throw new Error("Cannot set a formula on an input variable.");
    }
    const allIds = listCustomVariables(db).map((v) => v.id);
    const result = validateCustomFormula(patch.formula, allIds);
    if (!result.ok) {
      throw new Error(`Invalid formula: ${result.error}`);
    }
    const updatedDefs = listCustomVariables(db).map((v) =>
      v.id === id ? { ...v, formula: patch.formula } : v,
    );
    try {
      topoSortCustomVars(updatedDefs);
    } catch (err) {
      if (err instanceof CycleError) {
        throw new Error("This formula creates a cycle in variable dependencies.");
      }
    }
  }
  if (patch.label !== undefined) {
    db.prepare("update custom_variables set label = ? where id = ?").run(patch.label, id);
  }
  if (patch.formula !== undefined) {
    db.prepare("update custom_variables set formula = ? where id = ?").run(patch.formula, id);
  }
  if (patch.sortOrder !== undefined) {
    db.prepare("update custom_variables set sort_order = ? where id = ?").run(patch.sortOrder, id);
  }
  return listCustomVariables(db).find((v) => v.id === id)!;
}

export function deleteCustomVariable(db: DatabaseSync, id: string): void {
  const existing = db.prepare("select id from custom_variables where id = ?").get(id);
  if (!existing) {
    throw new Error(`Variable "${id}" not found.`);
  }
  const inUse = db
    .prepare("select count(*) as cnt from custom_variable_values where var_id = ?")
    .get(id) as { cnt: number };
  if (inUse.cnt > 0) {
    throw new Error(
      `Variable "${id}" has values saved in scenarios. Clear scenario values first.`,
    );
  }
  db.prepare("delete from custom_variables where id = ?").run(id);
}

export function deleteCustomVariableValuesByScenario(db: DatabaseSync, scenarioId: string): void {
  db.prepare("delete from custom_variable_values where scenario_id = ?").run(scenarioId);
}

export function readCustomVarValues(
  db: DatabaseSync,
  scenarioId: string,
): {
  customVarGlobal: CustomVarValues;
  customVarMonthly: Record<string, Partial<CustomVarValues>>;
  customVarOverrides: Record<
    string,
    { global?: Partial<CustomVarValues>; monthly?: Record<string, Partial<CustomVarValues>> }
  >;
} {
  const rows = db
    .prepare(
      "select var_id, scope, value from custom_variable_values where scenario_id = ?",
    )
    .all(scenarioId) as { var_id: string; scope: string; value: number }[];

  const customVarGlobal: CustomVarValues = {};
  const customVarMonthly: Record<string, Partial<CustomVarValues>> = {};
  const customVarOverrides: Record<
    string,
    { global?: Partial<CustomVarValues>; monthly?: Record<string, Partial<CustomVarValues>> }
  > = {};

  for (const row of rows) {
    if (row.scope === "global") {
      customVarGlobal[row.var_id] = row.value;
    } else if (row.scope.startsWith("monthly:")) {
      const month = row.scope.slice("monthly:".length);
      (customVarMonthly[month] ??= {})[row.var_id] = row.value;
    } else if (row.scope.startsWith("dept:")) {
      const rest = row.scope.slice("dept:".length);
      const monthlyMarker = ":monthly:";
      const mi = rest.indexOf(monthlyMarker);
      if (mi === -1) {
        const override = (customVarOverrides[rest] ??= {});
        (override.global ??= {})[row.var_id] = row.value;
      } else {
        const dept = rest.slice(0, mi);
        const month = rest.slice(mi + monthlyMarker.length);
        const override = (customVarOverrides[dept] ??= {});
        ((override.monthly ??= {})[month] ??= {})[row.var_id] = row.value;
      }
    }
  }

  return { customVarGlobal, customVarMonthly, customVarOverrides };
}

export function replaceCustomVarValues(
  db: DatabaseSync,
  scenarioId: string,
  assumptions: ScenarioAssumptions,
): void {
  db.prepare("delete from custom_variable_values where scenario_id = ?").run(scenarioId);
  const insert = db.prepare(
    "insert into custom_variable_values (scenario_id, var_id, scope, value) values (?, ?, ?, ?)",
  );

  for (const [varId, value] of Object.entries(assumptions.customVarGlobal ?? {})) {
    insert.run(scenarioId, varId, "global", value);
  }
  for (const [month, vars] of Object.entries(assumptions.customVarMonthly ?? {})) {
    for (const [varId, value] of Object.entries(vars)) {
      if (value !== undefined) insert.run(scenarioId, varId, `monthly:${month}`, value);
    }
  }
  for (const [dept, override] of Object.entries(assumptions.customVarOverrides ?? {})) {
    for (const [varId, value] of Object.entries(override.global ?? {})) {
      if (value !== undefined) insert.run(scenarioId, varId, `dept:${dept}`, value);
    }
    for (const [month, vars] of Object.entries(override.monthly ?? {})) {
      for (const [varId, value] of Object.entries(vars)) {
        if (value !== undefined) insert.run(scenarioId, varId, `dept:${dept}:monthly:${month}`, value);
      }
    }
  }
}

export function validateCustomVariableFormula(
  formula: string,
  availableIds: string[],
): { ok: true } | { ok: false; error: string } {
  return validateCustomFormula(formula, availableIds);
}
