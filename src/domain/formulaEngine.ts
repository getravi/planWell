import { create, all } from "mathjs";
import type { CoreAccount } from "./types.ts";

const math = create(all);

export type FormulaContext = {
  base: number;
  growthRate: number;
  cogsPct: number;
  costPerHead: number;
  month: number;
  revenue: number;
  headcount: number;
};

export const DEFAULT_FORMULAS: Record<CoreAccount, string> = {
  Revenue: "base * pow(1 + growthRate, month)",
  COGS: "revenue * cogsPct",
  Headcount: "base * pow(1 + growthRate, month)",
  OpEx: "headcount * costPerHead",
};

export function evaluateFormula(formula: string, context: FormulaContext): number {
  const result = math.evaluate(formula, { ...context });
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error(`Formula returned a non-finite number`);
  }
  return result;
}

export type FormulaValidationResult = { ok: true } | { ok: false; error: string };

export function validateFormula(formula: string, account: CoreAccount): FormulaValidationResult {
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
    growthRate: 0.05,
    cogsPct: 0.4,
    costPerHead: 15000,
    month: 1,
    revenue: account === "COGS" || account === "OpEx" ? 1000 : 0,
    headcount: account === "OpEx" ? 20 : 0,
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
