/**
 * @module pivot
 * Pure pivot, aggregation, grid-export, and paste-parsing helpers.
 *
 * These functions are stateless and have no React dependencies, making them
 * easy to test in isolation and reuse across multiple page components.
 */

import type { ActualRow, DimensionMember, VarianceRow } from "../domain/types.ts";
import type { MetricSummary } from "./api.ts";
import { buildDescendantLookup, flattenMembers } from "./dimension-utils.ts";
import { formatCell, number } from "./format.ts";

// ---------------------------------------------------------------------------
// Pivot row shapes
// ---------------------------------------------------------------------------

/** A single row in a pivoted actuals/forecast grid (one row per dept × account). */
export type PivotActualRow = {
  department: string;
  account: string;
  /** Map of month → value (summed when multiple source rows exist). */
  values: Record<string, number>;
  hierarchyLevel: number;
  /** True when this row represents a parent/rollup department. */
  isParent: boolean;
};

/** A single row in a pivoted variance grid. */
export type PivotVarianceRow = {
  department: string;
  account: string;
  values: Record<string, { variance: number; variancePct: number | null }>;
  hierarchyLevel: number;
  isParent: boolean;
};

/** A variance row enriched with a favorability direction label. */
export type VarianceInsight = VarianceRow & {
  favorability: "favorable" | "unfavorable";
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type DepartmentTableEntry = {
  name: string;
  level: number;
  isParent: boolean;
};

// ---------------------------------------------------------------------------
// Month extraction
// ---------------------------------------------------------------------------

/**
 * Returns a sorted, de-duplicated list of distinct months from any set of
 * rows that carry a `month` property.
 */
export function getMonths(rows: { month: string }[]): string[] {
  return [...new Set(rows.map((row) => row.month))].sort((left, right) =>
    left.localeCompare(right),
  );
}

/**
 * Returns a human-readable forecast horizon label such as
 * `"Horizon 2026-01 to 2026-12"`, or `null` when the month list is empty.
 */
export function formatHorizonLabel(months: string[]): string | null {
  if (months.length === 0) {
    return null;
  }
  return `Horizon ${months[0]} to ${months[months.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Pivot — actuals / forecast
// ---------------------------------------------------------------------------

/**
 * Pivots a flat list of cube rows into department × account rows with a
 * `values` map of month → summed value.
 *
 * When a `departmentHierarchy` is provided, parent rollup rows are inserted
 * before their children so the grid reflects the tree structure.
 */
export function pivotActualRows(
  rows: ActualRow[],
  departmentHierarchy: DimensionMember[],
  accountHierarchy: DimensionMember[],
): PivotActualRow[] {
  const accountOrder = orderLookup(flattenMembers(accountHierarchy).map((member) => member.name));
  const departments = visibleDepartmentEntries(rows, departmentHierarchy);
  if (departments.length > 0) {
    return departments.flatMap((department) =>
      pivotActualRowsForDepartment(
        scopedDepartmentRows(rows, department.name, departmentHierarchy),
        department,
        accountOrder,
      ),
    );
  }
  return pivotActualRowsForDepartment(rows, undefined, accountOrder);
}

function pivotActualRowsForDepartment(
  rows: ActualRow[],
  department?: DepartmentTableEntry,
  accountOrder = new Map<string, number>(),
): PivotActualRow[] {
  const byKey = new Map<string, PivotActualRow>();
  for (const row of rows) {
    const departmentName = department?.name ?? row.department;
    const key = `${departmentName}|${row.account}`;
    const current = byKey.get(key) ?? {
      department: departmentName,
      account: row.account,
      values: {},
      hierarchyLevel: department?.level ?? 0,
      isParent: department?.isParent ?? false,
    };
    current.values[row.month] = (current.values[row.month] ?? 0) + row.value;
    byKey.set(key, current);
  }
  return [...byKey.values()].sort(sortPivotRows(accountOrder));
}

// ---------------------------------------------------------------------------
// Pivot — variance
// ---------------------------------------------------------------------------

/**
 * Pivots a flat list of variance rows into department × account rows with a
 * `values` map of month → `{ variance, variancePct }`.
 *
 * Applies the same hierarchy-aware rollup logic as `pivotActualRows`.
 */
export function pivotVarianceRows(
  rows: VarianceRow[],
  departmentHierarchy: DimensionMember[],
  accountHierarchy: DimensionMember[],
): PivotVarianceRow[] {
  const accountOrder = orderLookup(flattenMembers(accountHierarchy).map((member) => member.name));
  const departments = visibleDepartmentEntries(rows, departmentHierarchy);
  if (departments.length > 0) {
    return departments.flatMap((department) =>
      pivotVarianceRowsForDepartment(
        scopedDepartmentRows(rows, department.name, departmentHierarchy),
        department,
        accountOrder,
      ),
    );
  }
  return pivotVarianceRowsForDepartment(rows, undefined, accountOrder);
}

function pivotVarianceRowsForDepartment(
  rows: VarianceRow[],
  department?: DepartmentTableEntry,
  accountOrder = new Map<string, number>(),
): PivotVarianceRow[] {
  const byKey = new Map<string, PivotVarianceRow>();
  for (const row of rows) {
    const departmentName = department?.name ?? row.department;
    const key = `${departmentName}|${row.account}`;
    const current = byKey.get(key) ?? {
      department: departmentName,
      account: row.account,
      values: {},
      hierarchyLevel: department?.level ?? 0,
      isParent: department?.isParent ?? false,
    };
    const cell = current.values[row.month] ?? { variance: 0, variancePct: null };
    cell.variance += row.variance;
    cell.variancePct = row.variancePct;
    current.values[row.month] = cell;
    byKey.set(key, current);
  }
  return [...byKey.values()].sort(sortPivotRows(accountOrder));
}

// ---------------------------------------------------------------------------
// Department entry helpers
// ---------------------------------------------------------------------------

function visibleDepartmentEntries(
  rows: { department: string }[],
  departmentHierarchy: DimensionMember[],
): DepartmentTableEntry[] {
  if (departmentHierarchy.length === 0) {
    return [];
  }
  const descendantLookup = buildDescendantLookup(departmentHierarchy);
  const entries = flattenDepartmentEntries(departmentHierarchy);
  const hierarchyNames = new Set(entries.map((entry) => entry.name));
  const visibleEntries = entries.filter((entry) => {
    const scopedNames = descendantLookup.get(entry.name) ?? [entry.name];
    return rows.some((row) => scopedNames.includes(row.department));
  });
  const unknownEntries = [...new Set(rows.map((row) => row.department))]
    .filter((department) => !hierarchyNames.has(department))
    .sort((left, right) => left.localeCompare(right))
    .map((department) => ({ name: department, level: 0, isParent: false }));
  return [...visibleEntries, ...unknownEntries];
}

function flattenDepartmentEntries(members: DimensionMember[], level = 0): DepartmentTableEntry[] {
  return members.flatMap((member) => [
    { name: member.name, level, isParent: member.children.length > 0 },
    ...flattenDepartmentEntries(member.children, level + 1),
  ]);
}

function scopedDepartmentRows<T extends { department: string }>(
  rows: T[],
  department: string,
  departmentHierarchy: DimensionMember[],
): T[] {
  const scopedNames = buildDescendantLookup(departmentHierarchy).get(department) ?? [department];
  return rows.filter((row) => scopedNames.includes(row.department));
}

function orderLookup(names: string[]): Map<string, number> {
  return new Map(names.map((name, index) => [name, index]));
}

function sortPivotRows(accountOrder: Map<string, number>) {
  return (
    left: { department: string; account: string },
    right: { department: string; account: string },
  ): number => {
    const leftAccountOrder = accountOrder.get(left.account) ?? Number.POSITIVE_INFINITY;
    const rightAccountOrder = accountOrder.get(right.account) ?? Number.POSITIVE_INFINITY;
    return (
      left.department.localeCompare(right.department) ||
      leftAccountOrder - rightAccountOrder ||
      left.account.localeCompare(right.account)
    );
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregates cube rows for a single account by month, returning
 * `[{ month, value }]` sorted ascending.
 */
export function aggregateByMonth(
  rows: ActualRow[],
  account: string,
): { month: string; value: number }[] {
  const byMonth = new Map<string, number>();
  for (const row of rows.filter((item) => item.account === account)) {
    byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + row.value);
  }
  return [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, value]) => ({ month, value }));
}

/**
 * Aggregates variance rows for a single account by month, returning
 * `[{ month, leftValue, rightValue }]` sorted ascending.
 */
export function aggregateVarianceByMonth(
  rows: VarianceRow[],
  account: string,
): { month: string; leftValue: number; rightValue: number }[] {
  const byMonth = new Map<string, { month: string; leftValue: number; rightValue: number }>();
  for (const row of rows.filter((item) => item.account === account)) {
    const current = byMonth.get(row.month) ?? { month: row.month, leftValue: 0, rightValue: 0 };
    current.leftValue += row.leftValue;
    current.rightValue += row.rightValue;
    byMonth.set(row.month, current);
  }
  return [...byMonth.values()].sort((left, right) => left.month.localeCompare(right.month));
}

// ---------------------------------------------------------------------------
// KPI summaries
// ---------------------------------------------------------------------------

/**
 * Computes a `MetricSummary` from a flat list of actuals/forecast rows.
 * Used on the client to derive KPIs from filtered rows (e.g. per-department).
 */
export function summarizeRows(rows: ActualRow[]): MetricSummary {
  const revenue = sumAccount(rows, "Revenue");
  const cogs = sumAccount(rows, "COGS");
  const opex = sumAccount(rows, "OpEx");
  const headcount = sumAccount(rows, "Headcount");
  const grossMargin = revenue - cogs;
  const departments = new Map<
    string,
    { department: string; revenue: number; cogs: number; opex: number; headcount: number }
  >();
  for (const row of rows) {
    const current = departments.get(row.department) ?? {
      department: row.department,
      revenue: 0,
      cogs: 0,
      opex: 0,
      headcount: 0,
    };
    if (row.account === "Revenue") current.revenue += row.value;
    if (row.account === "COGS") current.cogs += row.value;
    if (row.account === "OpEx") current.opex += row.value;
    if (row.account === "Headcount") current.headcount += row.value;
    departments.set(row.department, current);
  }
  return {
    kpis: {
      revenue,
      cogs,
      grossMargin,
      grossMarginPct: revenue === 0 ? null : grossMargin / revenue,
      opex,
      opexRatio: revenue === 0 ? null : opex / revenue,
      headcount,
    },
    accounts: [...new Set(rows.map((row) => row.account))]
      .sort((left, right) => left.localeCompare(right))
      .map((account) => ({ account, value: sumAccount(rows, account) })),
    departments: [...departments.values()].sort((left, right) =>
      left.department.localeCompare(right.department),
    ),
    months: getMonths(rows),
  };
}

/**
 * Derives a `MetricSummary` from variance rows by treating `variance` as the
 * value. This allows the KPI strip to show variance KPIs instead of absolutes.
 */
export function summarizeVarianceRows(rows: VarianceRow[]): MetricSummary {
  const varianceRows = rows.map((row) => ({ ...row, value: row.variance }));
  return summarizeRows(varianceRows);
}

function sumAccount(rows: ActualRow[], account: string): number {
  return rows.filter((row) => row.account === account).reduce((total, row) => total + row.value, 0);
}

// ---------------------------------------------------------------------------
// Variance insights
// ---------------------------------------------------------------------------

/**
 * Returns the single most favorable and most unfavorable variance row from a
 * set of variance rows (ranked by absolute variance magnitude).
 */
export function buildVarianceInsights(rows: VarianceRow[]): {
  favorable?: VarianceInsight;
  unfavorable?: VarianceInsight;
} {
  const insights = rows
    .filter((row) => row.variance !== 0)
    .map((row) => ({ ...row, favorability: varianceFavorability(row) }));
  return {
    favorable: largestByAbsoluteVariance(
      insights.filter((row) => row.favorability === "favorable"),
    ),
    unfavorable: largestByAbsoluteVariance(
      insights.filter((row) => row.favorability === "unfavorable"),
    ),
  };
}

function largestByAbsoluteVariance(rows: VarianceInsight[]): VarianceInsight | undefined {
  return rows.sort((left, right) => Math.abs(right.variance) - Math.abs(left.variance))[0];
}

function varianceFavorability(row: VarianceRow): VarianceInsight["favorability"] {
  if (row.account === "Revenue") {
    return row.variance > 0 ? "favorable" : "unfavorable";
  }
  return row.variance < 0 ? "favorable" : "unfavorable";
}

/**
 * Returns a human-readable description of a variance insight.
 * @example describeVarianceInsight(row) → "Revenue increased by $200"
 */
export function describeVarianceInsight(row: VarianceInsight): string {
  const direction = row.variance >= 0 ? "increased" : "decreased";
  return `${row.account} ${direction} by ${formatCell(row.account, Math.abs(row.variance))}`;
}

// ---------------------------------------------------------------------------
// Grid TSV export
// ---------------------------------------------------------------------------

export function buildActualGridMatrix(
  months: string[],
  rows: PivotActualRow[],
): { headers: string[]; rows: (string | number)[][] } {
  return {
    headers: ["Department", "Account", ...months],
    rows: rows.map((row) => [
      row.department,
      row.account,
      ...months.map((m) => Math.round(row.values[m] ?? 0)),
    ]),
  };
}

export function buildVarianceGridMatrix(
  months: string[],
  rows: PivotVarianceRow[],
): { headers: string[]; rows: (string | number)[][] } {
  return {
    headers: ["Department", "Account", ...months],
    rows: rows.map((row) => [
      row.department,
      row.account,
      ...months.map((m) => Math.round(row.values[m]?.variance ?? 0)),
    ]),
  };
}

/**
 * Serializes a pivoted actuals/forecast grid to a TSV string suitable for
 * pasting into spreadsheet applications.
 */
export function buildActualGridTsv(months: string[], rows: PivotActualRow[]): string {
  return [
    ["Department", "Account", ...months].join("\t"),
    ...rows.map((row) =>
      [
        row.department,
        row.account,
        ...months.map((month) => String(Math.round(row.values[month] ?? 0))),
      ].join("\t"),
    ),
  ].join("\n");
}

/**
 * Serializes a pivoted variance grid to a TSV string.
 */
export function buildVarianceGridTsv(months: string[], rows: PivotVarianceRow[]): string {
  return [
    ["Department", "Account", ...months].join("\t"),
    ...rows.map((row) =>
      [
        row.department,
        row.account,
        ...months.map((month) => String(Math.round(row.values[month]?.variance ?? 0))),
      ].join("\t"),
    ),
  ].join("\n");
}

/**
 * Serializes a driver assumptions grid to a TSV string, scaling percent
 * drivers by 100 for human readability.
 */
export function buildDriverGridTsv(
  months: string[],
  driverRows: { field: string; label: string; percent?: boolean }[],
  getDisplayDrivers: (month: string) => Record<string, number>,
): string {
  const rows = driverRows.map((driver) => {
    const values = months.map((month) => {
      const displayDrivers = getDisplayDrivers(month);
      const value = displayDrivers[driver.field] ?? 0;
      return driver.percent ? number(value * 100) : number(value);
    });
    return [driver.label, ...values].join("\t");
  });
  return [["Driver", ...months].join("\t"), ...rows].join("\n");
}

/**
 * Copies a TSV string to the clipboard using the Clipboard API.
 * No-op if the Clipboard API is unavailable (e.g. in tests).
 */
export function copyGrid(text: string): void {
  void navigator.clipboard?.writeText(text);
}

// ---------------------------------------------------------------------------
// Paste parsing
// ---------------------------------------------------------------------------

/**
 * Parses a pasted text block (TSV or CSV) into a 2D array of strings.
 * Returns an empty array for blank input.
 * Each row is a tab-delimited line when tabs are present, otherwise CSV.
 */
export function parsePastedGrid(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
  if (!normalized.trim()) {
    return [];
  }
  return normalized
    .split("\n")
    .map((line) => (line.includes("\t") ? line.split("\t") : parseCsvRow(line)))
    .filter((row) => row.some((cell) => cell.trim()));
}

/**
 * Parses a single CSV line, handling double-quoted fields and escaped quotes.
 */
export function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell);
  return cells;
}

/**
 * Returns `true` when the parsed grid has more than one row or more than one
 * column in any row (i.e. it is a multi-cell range, not a single value).
 */
export function isMultiCellGrid(lines: string[][]): boolean {
  return lines.length > 1 || lines.some((line) => line.length > 1);
}
