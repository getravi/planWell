import type { ActualRow } from "./types.ts";

export type DriverSuggestion = {
  revenueGrowthRate: number;
  cogsPctOfRevenue: number;
  headcountGrowthRate: number;
  costPerHead: number;
};

export type BaselineSuggestions = {
  global: DriverSuggestion;
  byDepartment: Record<string, DriverSuggestion>;
};

function monthlyCAGR(values: number[]): number {
  const sorted = values.filter((v) => v > 0);
  if (sorted.length < 2) return 0;
  // Use first and last, capped at 6 periods for stability
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const n = sorted.length - 1;
  return Math.pow(last / first, 1 / n) - 1;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function suggestForSeries(
  revenueByMonth: Map<string, number>,
  cogsByMonth: Map<string, number>,
  headcountByMonth: Map<string, number>,
  opexByMonth: Map<string, number>,
): DriverSuggestion {
  const months = [...revenueByMonth.keys()].sort();

  const revenueValues = months.map((m) => revenueByMonth.get(m) ?? 0);
  const headcountValues = months.map((m) => headcountByMonth.get(m) ?? 0);

  const revenueGrowthRate = monthlyCAGR(revenueValues);
  const headcountGrowthRate = monthlyCAGR(headcountValues);

  const cogsPcts = months
    .map((m) => {
      const rev = revenueByMonth.get(m) ?? 0;
      const cogs = cogsByMonth.get(m) ?? 0;
      return rev > 0 ? cogs / rev : null;
    })
    .filter((v): v is number => v !== null);

  const costPerHeadValues = months
    .map((m) => {
      const hc = headcountByMonth.get(m) ?? 0;
      const opex = opexByMonth.get(m) ?? 0;
      return hc > 0 ? opex / hc : null;
    })
    .filter((v): v is number => v !== null);

  return {
    revenueGrowthRate,
    cogsPctOfRevenue: mean(cogsPcts),
    headcountGrowthRate,
    costPerHead: mean(costPerHeadValues),
  };
}

export function suggestDrivers(actuals: ActualRow[]): BaselineSuggestions {
  // Group by department → account → month → value
  type MonthMap = Map<string, number>;
  type AccountMap = Map<string, MonthMap>;
  const byDept = new Map<string, AccountMap>();

  for (const row of actuals) {
    let deptMap = byDept.get(row.department);
    if (!deptMap) {
      deptMap = new Map();
      byDept.set(row.department, deptMap);
    }
    let monthMap = deptMap.get(row.account);
    if (!monthMap) {
      monthMap = new Map();
      deptMap.set(row.account, monthMap);
    }
    monthMap.set(row.month, row.value);
  }

  // Also build global totals
  const globalRevenue = new Map<string, number>();
  const globalCogs = new Map<string, number>();
  const globalHeadcount = new Map<string, number>();
  const globalOpex = new Map<string, number>();

  const byDepartment: Record<string, DriverSuggestion> = {};

  for (const [dept, accountMap] of byDept) {
    const rev = accountMap.get("Revenue") ?? new Map();
    const cogs = accountMap.get("COGS") ?? new Map();
    const hc = accountMap.get("Headcount") ?? new Map();
    const opex = accountMap.get("OpEx") ?? new Map();

    for (const [m, v] of rev) globalRevenue.set(m, (globalRevenue.get(m) ?? 0) + v);
    for (const [m, v] of cogs) globalCogs.set(m, (globalCogs.get(m) ?? 0) + v);
    for (const [m, v] of hc) globalHeadcount.set(m, (globalHeadcount.get(m) ?? 0) + v);
    for (const [m, v] of opex) globalOpex.set(m, (globalOpex.get(m) ?? 0) + v);

    byDepartment[dept] = suggestForSeries(rev, cogs, hc, opex);
  }

  return {
    global: suggestForSeries(globalRevenue, globalCogs, globalHeadcount, globalOpex),
    byDepartment,
  };
}
