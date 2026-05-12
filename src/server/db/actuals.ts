import { DatabaseSync } from "node:sqlite";
import type { ActualRow } from "../../domain/types.ts";
import { flattenDimensionNames, listNamedDimension, getDescendants } from "./dimensions.ts";

export function countRows(
  db: DatabaseSync,
  table: "actuals" | "forecast_values",
  column: "month" | "department" | "account",
  value: string,
): number {
  const row = db
    .prepare(`select count(*) as count from ${table} where ${column} = ?`)
    .get(value) as {
    count: number;
  };
  return row.count;
}

export function selectCubeRows(
  db: DatabaseSync,
  table: "actuals" | "forecast_values",
): ActualRow[] {
  return db
    .prepare(
      `select month, department, account, value from ${table} order by month, department, account`,
    )
    .all() as ActualRow[];
}

export function sum(rows: ActualRow[], account: string): number {
  return (
    Math.round(
      rows.filter((row) => row.account === account).reduce((total, row) => total + row.value, 0) *
        100,
    ) / 100
  );
}

export function summarizeDepartments(
  db: DatabaseSync,
  rows: ActualRow[],
): {
  department: string;
  revenue: number;
  cogs: number;
  opex: number;
  headcount: number;
}[] {
  const dimensionNames = flattenDimensionNames(listNamedDimension(db, "department"));
  const rowDepartments = new Set(rows.map((row) => row.department));
  const knownDepartments = new Set(dimensionNames);
  const names = [
    ...dimensionNames,
    ...[...rowDepartments]
      .filter((department) => !knownDepartments.has(department))
      .sort((left, right) => left.localeCompare(right)),
  ];

  return names
    .map((department) => {
      const descendants = getDescendants(db, "department", department);
      const scopedNames = new Set([department, ...descendants]);
      const scoped = rows.filter((row) => scopedNames.has(row.department));
      return {
        department,
        revenue: sum(scoped, "Revenue"),
        cogs: sum(scoped, "COGS"),
        opex: sum(scoped, "OpEx"),
        headcount: closingBalance(scoped, "Headcount"),
      };
    })
    .filter(
      (department) =>
        department.revenue !== 0 ||
        department.cogs !== 0 ||
        department.opex !== 0 ||
        department.headcount !== 0,
    );
}

export function summarizeAccounts(
  db: DatabaseSync,
  rows: ActualRow[],
): {
  account: string;
  value: number;
}[] {
  const dimensionNames = flattenDimensionNames(listNamedDimension(db, "account"));
  const rowAccounts = new Set(rows.map((row) => row.account));
  const knownAccounts = new Set(dimensionNames);
  const names = [
    ...dimensionNames,
    ...[...rowAccounts]
      .filter((account) => !knownAccounts.has(account))
      .sort((left, right) => left.localeCompare(right)),
  ];

  return names
    .map((account) => {
      const descendants = getDescendants(db, "account", account);
      const scopedNames = new Set([account, ...descendants]);
      const value = sumAll(rows.filter((row) => scopedNames.has(row.account)));
      return { account, value };
    })
    .filter((account) => account.value !== 0);
}

export function sumAll(rows: ActualRow[]): number {
  return Math.round(rows.reduce((total, row) => total + row.value, 0) * 100) / 100;
}

function closingBalance(rows: ActualRow[], account: string): number {
  const accountRows = rows.filter((row) => row.account === account);
  if (accountRows.length === 0) return 0;
  const lastMonth = accountRows
    .map((row) => row.month)
    .sort()
    .at(-1)!;
  return (
    Math.round(
      accountRows
        .filter((row) => row.month === lastMonth)
        .reduce((total, row) => total + row.value, 0) * 100,
    ) / 100
  );
}
