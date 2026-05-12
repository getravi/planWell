import {
  DEFAULT_FORMULAS,
  evaluateFormula,
  topoSortAccounts,
  topoSortCustomVars,
  type FormulaContext,
} from "./formulaEngine.ts";
import { logger } from "../logger.ts";
import type {
  ActualRow,
  CoreAccount,
  CustomVariableDef,
  DimensionMember,
  ForecastRow,
  KpiSummary,
  ScenarioAssumptions,
  VarianceRow,
} from "./types.ts";

function safeEvaluate(formula: string, ctx: FormulaContext, fallbackAccount?: string): number {
  try {
    return evaluateFormula(formula, ctx);
  } catch (err) {
    if (fallbackAccount) {
      logger.warn(
        { account: fallbackAccount, err: err instanceof Error ? err.message : String(err) },
        "formula.eval.failed",
      );
    }
    const fallbackFormula = fallbackAccount
      ? (DEFAULT_FORMULAS[fallbackAccount as CoreAccount] ?? "base")
      : "base";
    try {
      return evaluateFormula(fallbackFormula, ctx);
    } catch {
      return 0;
    }
  }
}

export function resolveVarValues(
  defs: CustomVariableDef[],
  assumptions: ScenarioAssumptions,
  department: string,
  month: string,
  monthIndex: number,
  ancestorLookup: Map<string, string[]>,
): Record<string, number> {
  const resolved: Record<string, number> = {};

  for (const def of defs.filter((d) => d.kind === "input")) {
    let value = def.defaultValue ?? 0;
    for (const ancestor of ancestorLookup.get(department) ?? []) {
      value = assumptions.varOverrides?.[ancestor]?.monthly?.[month]?.[def.id] ?? value;
    }
    value = assumptions.varOverrides?.[department]?.monthly?.[month]?.[def.id] ?? value;
    resolved[def.id] = value;
  }

  let sortedCalc: CustomVariableDef[];
  try {
    sortedCalc = topoSortCustomVars(defs.filter((d) => d.kind === "calculated"));
  } catch {
    sortedCalc = defs.filter((d) => d.kind === "calculated");
  }

  const baseCtx: FormulaContext = {
    base: 0,
    month: monthIndex,
    revenue: 0,
    headcount: 0,
    ...resolved,
  };

  for (const def of sortedCalc) {
    if (!def.formula) {
      resolved[def.id] = 0;
      continue;
    }
    try {
      resolved[def.id] = evaluateFormula(def.formula, { ...baseCtx, ...resolved });
    } catch {
      resolved[def.id] = 0;
    }
  }

  return resolved;
}

export function buildForecast(
  actuals: ActualRow[],
  assumptions: ScenarioAssumptions,
  departmentHierarchy: DimensionMember[] = [],
  forecastMonths?: string[],
  varDefs: CustomVariableDef[] = [],
  accountHierarchy: DimensionMember[] = [],
  actualsFormulas: Record<string, string> = {},
): ForecastRow[] {
  if (actuals.length === 0) {
    return [];
  }

  const departments = orderedDepartments(actuals, departmentHierarchy);
  const lastMonth = [...new Set(actuals.map((row) => row.month))].sort().at(-1);
  if (!lastMonth) {
    return [];
  }

  const accountsList = orderedAccounts(
    actuals,
    accountHierarchy,
    (assumptions.formulas ?? {}) as Record<string, string>,
  );
  const formulasForSort: Record<string, string> = {};
  for (const acc of accountsList) {
    formulasForSort[acc] =
      assumptions.formulas?.[acc] ??
      actualsFormulas[acc] ??
      DEFAULT_FORMULAS[acc as CoreAccount] ??
      "base";
  }
  const sortedAccounts = topoSortAccounts(accountsList, formulasForSort);

  const rows: ForecastRow[] = [];
  const ancestorsByDepartment = buildAncestorLookup(departmentHierarchy);
  const months = forecastMonths?.length ? forecastMonths : nextMonths(lastMonth, 12);
  for (const month of months.filter((month) => month > lastMonth)) {
    const monthIndex = monthsBetween(lastMonth, month);
    for (const department of departments) {
      const vars = resolveVarValues(
        varDefs,
        assumptions,
        department,
        month,
        monthIndex,
        ancestorsByDepartment,
      );

      const ctx: FormulaContext = {
        base: 0,
        month: monthIndex,
        revenue: 0,
        headcount: 0,
        ...vars,
      };

      for (const account of sortedAccounts) {
        const formula = formulasForSort[account];
        ctx.base = findLatestValue(actuals, department, account, lastMonth);

        let val = safeEvaluate(formula, ctx, account);
        if (account === "Headcount") {
          val = roundMetric(val);
        } else {
          val = roundCurrency(val);
        }

        ctx[account] = val;
        if (account === "Revenue") ctx.revenue = val;
        if (account === "Headcount") ctx.headcount = val;

        rows.push({ month, department, account, value: val });
      }
    }
  }

  return rows;
}

export function compareSeries(left: ActualRow[], right: ActualRow[]): VarianceRow[] {
  const leftMap = new Map(left.map((r) => [rowKey(r), r.value]));
  const rightMap = new Map(right.map((r) => [rowKey(r), r.value]));
  const keys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  return [...keys].sort().map((key) => {
    const [month, department, account] = JSON.parse(key) as [string, string, string];
    const leftValue = leftMap.get(key) ?? 0;
    const rightValue = rightMap.get(key) ?? 0;
    const variance = roundCurrency(rightValue - leftValue);
    return {
      month,
      department,
      account,
      leftValue,
      rightValue,
      variance,
      variancePct: leftValue === 0 ? null : variance / leftValue,
    };
  });
}

export function summarizeKpis(rows: ActualRow[]): KpiSummary {
  const revenue = sumByAccount(rows, "Revenue");
  const cogs = sumByAccount(rows, "COGS");
  const opex = sumByAccount(rows, "OpEx");
  const headcount = closingBalance(rows, "Headcount");
  const grossMargin = revenue - cogs;
  return {
    revenue,
    cogs,
    grossMargin,
    grossMarginPct: revenue === 0 ? null : grossMargin / revenue,
    opex,
    opexRatio: revenue === 0 ? null : opex / revenue,
    headcount,
  };
}

export function nextMonths(startMonth: string, count: number): string[] {
  const parts = startMonth.split("-");
  const yearRaw = Number(parts[0]);
  const monthRaw = Number(parts[1]);
  if (
    parts.length !== 2 ||
    !Number.isFinite(yearRaw) ||
    !Number.isFinite(monthRaw) ||
    monthRaw < 1 ||
    monthRaw > 12
  ) {
    return [];
  }
  const months: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const date = new Date(Date.UTC(yearRaw, monthRaw - 1 + index, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

function buildAncestorLookup(members: DimensionMember[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  const visit = (member: DimensionMember, ancestors: string[]) => {
    lookup.set(member.name, ancestors);
    for (const child of member.children) {
      visit(child, [...ancestors, member.name]);
    }
  };
  for (const member of members) {
    visit(member, []);
  }
  return lookup;
}

function orderedDepartments(rows: ActualRow[], departmentHierarchy: DimensionMember[]): string[] {
  const rowDepartments = new Set(rows.map((row) => row.department));
  const hierarchyOrder = flattenHierarchyNames(departmentHierarchy).filter((department) =>
    rowDepartments.has(department),
  );
  const knownDepartments = new Set(hierarchyOrder);
  const unknownDepartments = [...rowDepartments]
    .filter((department) => !knownDepartments.has(department))
    .sort((left, right) => left.localeCompare(right));
  return [...hierarchyOrder, ...unknownDepartments];
}

function orderedAccounts(
  rows: ActualRow[],
  accountHierarchy: DimensionMember[],
  formulas: Record<string, string>,
): string[] {
  const rowAccounts = new Set(rows.map((row) => row.account));
  const formulaAccounts = new Set(Object.keys(formulas));
  const hierarchyOrder = flattenHierarchyNames(accountHierarchy);

  const known = new Set(hierarchyOrder);
  const unknown = [
    ...new Set([...rowAccounts, ...formulaAccounts, "Revenue", "COGS", "Headcount", "OpEx"]),
  ]
    .filter((a) => !known.has(a))
    .sort((a, b) => a.localeCompare(b));

  return [...hierarchyOrder, ...unknown];
}

function flattenHierarchyNames(members: DimensionMember[]): string[] {
  return members.flatMap((member) => [member.name, ...flattenHierarchyNames(member.children)]);
}

function findLatestValue(
  actuals: ActualRow[],
  department: string,
  account: string,
  throughMonth: string,
): number {
  const row = actuals
    .filter(
      (item) =>
        item.department === department && item.account === account && item.month <= throughMonth,
    )
    .sort((left, right) => right.month.localeCompare(left.month))
    .at(0);
  return row?.value ?? 0;
}

function monthsBetween(startMonth: string, targetMonth: string): number {
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const [targetYear, targetMonthNumber] = targetMonth.split("-").map(Number);
  return (targetYear - startYear) * 12 + targetMonthNumber - startMonthNumber;
}

function rowKey(row: ActualRow): string {
  return JSON.stringify([row.month, row.department, row.account]);
}

function sumByAccount(rows: ActualRow[], account: string): number {
  return roundCurrency(
    rows.filter((row) => row.account === account).reduce((sum, row) => sum + row.value, 0),
  );
}

function closingBalance(rows: ActualRow[], account: string): number {
  const accountRows = rows.filter((row) => row.account === account);
  if (accountRows.length === 0) return 0;
  const lastMonth = accountRows
    .map((row) => row.month)
    .sort()
    .at(-1)!;
  return roundCurrency(
    accountRows.filter((row) => row.month === lastMonth).reduce((sum, row) => sum + row.value, 0),
  );
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}
