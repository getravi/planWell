import { DatabaseSync } from "node:sqlite";
import type { CustomVariableDef, ScenarioAssumptions } from "../../domain/types.ts";
import {
  topoSortCustomVars,
  validateCustomFormula,
  CycleError,
} from "../../domain/formulaEngine.ts";

const RESERVED_IDS = new Set([
  "base",
  "month",
  "revenue",
  "headcount",
  "pow",
  "sqrt",
  "abs",
  "max",
  "min",
  "round",
  "pi",
  "e",
  "true",
  "false",
  "NaN",
  "Infinity",
]);

const ID_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type CustomVariableRow = {
  id: string;
  label: string;
  kind: string;
  formula: string | null;
  sort_order: number;
  default_value: number | null;
};

export function listCustomVariables(db: DatabaseSync): CustomVariableDef[] {
  const rows = db
    .prepare(
      "select id, label, kind, formula, sort_order, default_value from custom_variables order by sort_order, id",
    )
    .all() as CustomVariableRow[];
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    kind: row.kind as "input" | "calculated",
    formula: row.formula ?? undefined,
    defaultValue: row.default_value ?? undefined,
  }));
}

export function createCustomVariable(db: DatabaseSync, def: CustomVariableDef): CustomVariableDef {
  if (!ID_PATTERN.test(def.id)) {
    throw new Error(
      `"${def.id}" is not a valid identifier. Use letters, digits, and underscores only.`,
    );
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
    (
      db.prepare("select coalesce(max(sort_order), 0) as m from custom_variables").get() as {
        m: number;
      }
    ).m + 10;
  db.prepare(
    "insert into custom_variables (id, label, kind, formula, sort_order, default_value) values (?, ?, ?, ?, ?, ?)",
  ).run(def.id, def.label, def.kind, def.formula ?? null, sortOrder, def.defaultValue ?? null);
  return listCustomVariables(db).find((v) => v.id === def.id)!;
}

export function updateCustomVariable(
  db: DatabaseSync,
  id: string,
  patch: { label?: string; formula?: string; sortOrder?: number; defaultValue?: number },
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
  if (patch.defaultValue !== undefined) {
    db.prepare("update custom_variables set default_value = ? where id = ?").run(
      patch.defaultValue,
      id,
    );
  }
  return listCustomVariables(db).find((v) => v.id === id)!;
}

export function deleteCustomVariable(db: DatabaseSync, id: string): void {
  const existing = db.prepare("select id from custom_variables where id = ?").get(id);
  if (!existing) {
    throw new Error(`Variable "${id}" not found.`);
  }

  const pattern = new RegExp(`\\b${id}\\b`);

  const calcVarRefs = (
    db
      .prepare(
        "select id, label, formula from custom_variables where kind = 'calculated' and id != ? and formula is not null",
      )
      .all(id) as { id: string; label: string; formula: string }[]
  ).filter((v) => pattern.test(v.formula));
  if (calcVarRefs.length > 0) {
    const names = calcVarRefs.map((v) => v.label).join(", ");
    throw new Error(
      `Variable "${id}" is used in the formula of: ${names}. Remove it from those formulas first.`,
    );
  }

  const scenarioFormulaRows = (
    db.prepare("select account, formula from scenario_formulas").all() as {
      account: string;
      formula: string;
    }[]
  ).filter((r) => pattern.test(r.formula));

  if (scenarioFormulaRows.length > 0) {
    const accounts = [...new Set(scenarioFormulaRows.map((r) => r.account))].join(", ");
    throw new Error(
      `Variable "${id}" is used in scenario formula overrides for: ${accounts}. Remove it from those formulas first.`,
    );
  }

  db.prepare("delete from custom_variable_values where var_id = ?").run(id);
  db.prepare("delete from custom_variables where id = ?").run(id);
}

export function deleteCustomVariableValuesByScenario(db: DatabaseSync, scenarioId: string): void {
  db.prepare("delete from custom_variable_values where scenario_id = ?").run(scenarioId);
}

export function readVarValues(
  db: DatabaseSync,
  scenarioId: string,
): Record<string, { monthly?: Record<string, Partial<Record<string, number>>> }> {
  const rows = db
    .prepare(
      "select var_id, scope, value from custom_variable_values where scenario_id = ? and scope like 'dept:%:monthly:%'",
    )
    .all(scenarioId) as { var_id: string; scope: string; value: number }[];

  const varOverrides: Record<
    string,
    { monthly?: Record<string, Partial<Record<string, number>>> }
  > = {};
  const monthlyMarker = ":monthly:";

  for (const row of rows) {
    const rest = row.scope.slice("dept:".length);
    const mi = rest.indexOf(monthlyMarker);
    if (mi === -1) continue;
    const dept = rest.slice(0, mi);
    const month = rest.slice(mi + monthlyMarker.length);
    const override = (varOverrides[dept] ??= {});
    ((override.monthly ??= {})[month] ??= {})[row.var_id] = row.value;
  }

  return varOverrides;
}

export function replaceVarValues(
  db: DatabaseSync,
  scenarioId: string,
  assumptions: ScenarioAssumptions,
): void {
  db.prepare("delete from custom_variable_values where scenario_id = ?").run(scenarioId);
  const insert = db.prepare(
    "insert into custom_variable_values (scenario_id, var_id, scope, value) values (?, ?, ?, ?)",
  );

  for (const [dept, override] of Object.entries(assumptions.varOverrides ?? {})) {
    for (const [month, vars] of Object.entries(override.monthly ?? {})) {
      for (const [varId, value] of Object.entries(vars)) {
        if (value !== undefined)
          insert.run(scenarioId, varId, `dept:${dept}:monthly:${month}`, value);
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
