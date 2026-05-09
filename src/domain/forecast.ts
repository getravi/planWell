import { DEFAULT_FORMULAS, evaluateFormula, type FormulaContext } from "./formulaEngine.ts";
import type {
  ActualRow,
  CoreAccount,
  DepartmentDriverOverride,
  DimensionMember,
  DriverAssumptions,
  ForecastRow,
  KpiSummary,
  ScenarioAssumptions,
  VarianceRow,
} from "./types.ts";

function safeEvaluate(formula: string, ctx: FormulaContext, fallback: CoreAccount): number {
  try {
    return evaluateFormula(formula, ctx);
  } catch {
    return evaluateFormula(DEFAULT_FORMULAS[fallback], ctx);
  }
}

const forecastAccounts = ["Revenue", "COGS", "Headcount", "OpEx"] as const;

export function buildForecast(
  actuals: ActualRow[],
  assumptions: ScenarioAssumptions,
  departmentHierarchy: DimensionMember[] = [],
  forecastMonths?: string[],
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
      const driver = resolveDriverAssumptions(
        assumptions.global,
        assumptions.monthly?.[month],
        assumptions.overrides[department],
        month,
        (ancestorsByDepartment.get(department) ?? []).map((name) => assumptions.overrides[name]),
      );
      const baseRevenue = findLatestValue(actuals, department, "Revenue", lastMonth);
      const baseHeadcount = findLatestValue(actuals, department, "Headcount", lastMonth);
      const baseCogs = findLatestValue(actuals, department, "COGS", lastMonth);
      const baseOpEx = findLatestValue(actuals, department, "OpEx", lastMonth);
      const formulaFor = (account: CoreAccount) =>
        assumptions.formulas?.[account] ?? DEFAULT_FORMULAS[account];
      const revenue = roundCurrency(
        safeEvaluate(
          formulaFor("Revenue"),
          {
            base: baseRevenue,
            growthRate: driver.revenueGrowthRate,
            cogsPct: driver.cogsPctOfRevenue,
            costPerHead: driver.costPerHead,
            month: monthIndex,
            revenue: 0,
            headcount: 0,
          },
          "Revenue",
        ),
      );
      const cogs = roundCurrency(
        safeEvaluate(
          formulaFor("COGS"),
          {
            base: baseCogs,
            growthRate: driver.revenueGrowthRate,
            cogsPct: driver.cogsPctOfRevenue,
            costPerHead: driver.costPerHead,
            month: monthIndex,
            revenue,
            headcount: 0,
          },
          "COGS",
        ),
      );
      const headcount = roundMetric(
        safeEvaluate(
          formulaFor("Headcount"),
          {
            base: baseHeadcount,
            growthRate: driver.headcountGrowthRate,
            cogsPct: driver.cogsPctOfRevenue,
            costPerHead: driver.costPerHead,
            month: monthIndex,
            revenue,
            headcount: 0,
          },
          "Headcount",
        ),
      );
      const opex = roundCurrency(
        safeEvaluate(
          formulaFor("OpEx"),
          {
            base: baseOpEx,
            growthRate: driver.headcountGrowthRate,
            cogsPct: driver.cogsPctOfRevenue,
            costPerHead: driver.costPerHead,
            month: monthIndex,
            revenue,
            headcount,
          },
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

export function resolveDriverAssumptions(
  global: DriverAssumptions,
  monthly: Partial<DriverAssumptions> | undefined,
  departmentOverride: DepartmentDriverOverride | undefined,
  month: string,
  inheritedOverrides: (DepartmentDriverOverride | undefined)[] = [],
): DriverAssumptions {
  const drivers = {
    ...global,
    ...monthly,
  };
  for (const override of [...inheritedOverrides, departmentOverride]) {
    const { monthly: departmentMonthly, ...departmentDefault } = override ?? {};
    Object.assign(drivers, departmentDefault, departmentMonthly?.[month]);
  }
  return drivers;
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
