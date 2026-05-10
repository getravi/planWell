import { DEFAULT_FORMULAS, evaluateFormula, topoSortCustomVars, type FormulaContext } from "./formulaEngine.ts";
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

function safeEvaluate(formula: string, ctx: FormulaContext, fallback: CoreAccount): number {
  try {
    return evaluateFormula(formula, ctx);
  } catch (err) {
    console.warn(
      `[planwell] Formula for ${fallback} failed: ${err instanceof Error ? err.message : String(err)}. Using default formula.`,
    );
    return evaluateFormula(DEFAULT_FORMULAS[fallback], ctx);
  }
}

const forecastAccounts = ["Revenue", "COGS", "Headcount", "OpEx"] as const;

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
    value = assumptions.varGlobal?.[def.id] ?? value;
    value = assumptions.varMonthly?.[month]?.[def.id] ?? value;
    for (const ancestor of ancestorLookup.get(department) ?? []) {
      value = assumptions.varOverrides?.[ancestor]?.global?.[def.id] ?? value;
      value = assumptions.varOverrides?.[ancestor]?.monthly?.[month]?.[def.id] ?? value;
    }
    value = assumptions.varOverrides?.[department]?.global?.[def.id] ?? value;
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
): ForecastRow[] {
  if (actuals.length === 0) {
    return [];
  }

  const departments = orderedDepartments(actuals, departmentHierarchy);
  const lastMonth = [...new Set(actuals.map((row) => row.month))].sort().at(-1);
  if (!lastMonth) {
    return [];
  }

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
      const formulaFor = (account: CoreAccount) =>
        assumptions.formulas?.[account] ?? DEFAULT_FORMULAS[account];
      const revenue = roundCurrency(
        safeEvaluate(
          formulaFor("Revenue"),
          { base: findLatestValue(actuals, department, "Revenue", lastMonth), month: monthIndex, revenue: 0, headcount: 0, ...vars },
          "Revenue",
        ),
      );
      const cogs = roundCurrency(
        safeEvaluate(
          formulaFor("COGS"),
          { base: findLatestValue(actuals, department, "COGS", lastMonth), month: monthIndex, revenue, headcount: 0, ...vars },
          "COGS",
        ),
      );
      const headcount = roundMetric(
        safeEvaluate(
          formulaFor("Headcount"),
          { base: findLatestValue(actuals, department, "Headcount", lastMonth), month: monthIndex, revenue, headcount: 0, ...vars },
          "Headcount",
        ),
      );
      const opex = roundCurrency(
        safeEvaluate(
          formulaFor("OpEx"),
          { base: findLatestValue(actuals, department, "OpEx", lastMonth), month: monthIndex, revenue, headcount, ...vars },
          "OpEx",
        ),
      );

      const values: Record<(typeof forecastAccounts)[number], number> = {
        Revenue: revenue,
        COGS: cogs,
        Headcount: headcount,
        OpEx: opex,
      };

      for (const account of forecastAccounts) {
        rows.push({ month, department, account, value: values[account] });
      }
    }
  }

  return rows;
}

export function compareSeries(left: ActualRow[], right: ActualRow[]): VarianceRow[] {
  const keys = new Set([...left.map(rowKey), ...right.map(rowKey)]);
  return [...keys].sort().map((key) => {
    const [month, department, account] = key.split("||");
    const leftValue = left.find((row) => rowKey(row) === key)?.value ?? 0;
    const rightValue = right.find((row) => rowKey(row) === key)?.value ?? 0;
    const variance = roundCurrency(rightValue - leftValue);
    return {
      month: month ?? "",
      department: department ?? "",
      account: account ?? "",
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
  const headcount = sumByAccount(rows, "Headcount");
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
  const [yearRaw, monthRaw] = startMonth.split("-").map(Number);
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
  return `${row.month}||${row.department}||${row.account}`;
}

function sumByAccount(rows: ActualRow[], account: string): number {
  return roundCurrency(
    rows.filter((row) => row.account === account).reduce((sum, row) => sum + row.value, 0),
  );
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}
