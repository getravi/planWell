import { create, all } from "mathjs";
import type { CoreAccount, CustomVariableDef } from "./types.ts";

const math = create(all);

// createUnit is not on mathjs's unsafe list so must be explicitly blocked.
// import is already blocked by mathjs internally (unsafe list) — do not add it here,
// as doing so with { override: true } would make it reachable as a symbol.
math.import(
  {
    createUnit: () => {
      throw new Error("createUnit is not allowed in formulas");
    },
  },
  { override: true },
);

export type FormulaContext = {
  base: number;
  month: number;
  revenue: number;
  headcount: number;
  [key: string]: number;
};

export const DEFAULT_FORMULAS: Record<CoreAccount, string> = {
  Revenue: "base * pow(1 + revenueGrowthRate, month)",
  COGS: "revenue * cogsPctOfRevenue",
  Headcount: "base * pow(1 + headcountGrowthRate, month)",
  OpEx: "headcount * costPerHead",
};

export const BUILTIN_VAR_IDS = [
  "revenueGrowthRate",
  "cogsPctOfRevenue",
  "headcountGrowthRate",
  "costPerHead",
] as const;

export type BuiltinVarId = (typeof BUILTIN_VAR_IDS)[number];

export function evaluateFormula(formula: string, context: FormulaContext): number {
  const result = math.evaluate(formula, { ...context });
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error(`Formula returned a non-finite number`);
  }
  return result;
}

export type FormulaValidationResult = { ok: true } | { ok: false; error: string };

export class CycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CycleError";
  }
}

function extractSymbolNames(formula: string): string[] {
  try {
    const node = math.parse(formula);
    const names: string[] = [];
    node.traverse((n) => {
      const sym = n as unknown as { isSymbolNode?: boolean; name?: string };
      if (sym.isSymbolNode && typeof sym.name === "string") {
        names.push(sym.name);
      }
    });
    return names;
  } catch {
    return [];
  }
}

export function topoSortCustomVars(defs: CustomVariableDef[]): CustomVariableDef[] {
  const defMap = new Map(defs.map((d) => [d.id, d]));
  const allIds = new Set(defs.map((d) => d.id));

  const inDegree = new Map<string, number>(defs.map((d) => [d.id, 0]));
  const edges = new Map<string, string[]>(defs.map((d) => [d.id, []]));

  for (const def of defs) {
    if (def.kind !== "calculated" || !def.formula) continue;
    const deps = [
      ...new Set(extractSymbolNames(def.formula).filter((s) => allIds.has(s) && s !== def.id)),
    ];
    for (const dep of deps) {
      edges.get(dep)!.push(def.id);
      inDegree.set(def.id, (inDegree.get(def.id) ?? 0) + 1);
    }
  }

  const queue = defs.filter((d) => (inDegree.get(d.id) ?? 0) === 0);
  const sorted: CustomVariableDef[] = [];

  while (queue.length > 0) {
    const def = queue.shift()!;
    sorted.push(def);
    for (const dependent of edges.get(def.id) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(defMap.get(dependent)!);
      }
    }
  }

  if (sorted.length !== defs.length) {
    throw new CycleError("Cycle detected in custom variable formulas.");
  }

  return sorted;
}

export function validateCustomFormula(
  formula: string,
  availableIds: string[],
): FormulaValidationResult {
  try {
    math.parse(formula);
  } catch (err) {
    return {
      ok: false,
      error: `Syntax error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const sentinels: Record<string, number> = {};
  for (const id of availableIds) {
    sentinels[id] = 1;
  }
  const dryRunContext: FormulaContext = {
    base: 1000,
    month: 1,
    revenue: 1000,
    headcount: 20,
    ...sentinels,
  };
  try {
    const value = evaluateFormula(formula, dryRunContext);
    if (!Number.isFinite(value)) {
      return { ok: false, error: "Formula returned a non-finite value on dry run." };
    }
  } catch (err) {
    return {
      ok: false,
      error: `Runtime error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true };
}

export function validateFormula(
  formula: string,
  account: CoreAccount,
  extraVars?: Record<string, number>,
): FormulaValidationResult {
  try {
    math.parse(formula);
  } catch (err) {
    return {
      ok: false,
      error: `Syntax error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const dryRunContext: FormulaContext = {
    base: 1000,
    month: 1,
    revenue: account === "COGS" || account === "OpEx" ? 1000 : 0,
    headcount: account === "OpEx" ? 20 : 0,
    ...extraVars,
  };
  try {
    const value = evaluateFormula(formula, dryRunContext);
    if (!Number.isFinite(value)) {
      return { ok: false, error: "Formula returned a non-finite value on dry run." };
    }
  } catch (err) {
    return {
      ok: false,
      error: `Runtime error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true };
}
