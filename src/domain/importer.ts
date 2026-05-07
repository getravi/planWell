import { parse } from "csv-parse/sync";
import type { ActualRow, ImportResult } from "./types.ts";

const longHeaders = new Set(["month", "department", "account", "value"]);
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

type CsvRecord = Record<string, string | undefined>;

export function parseActualsCsv(csvText: string): ImportResult {
  const records = parse(csvText, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRecord[];

  if (records.length === 0) {
    throw new Error("CSV has no data rows.");
  }

  const headers = Object.keys(records[0] ?? {}).map((header) => normalizeHeader(header));
  const shape =
    headers.every((header) => longHeaders.has(header)) && longHeaders.size === headers.length
      ? "long"
      : "wide";
  const rows = shape === "long" ? normalizeLongRows(records) : normalizeWideRows(records);
  const { rows: aggregated, duplicateCount } = aggregateRows(rows);
  const warnings =
    duplicateCount > 0
      ? [
          `Aggregated ${duplicateCount} duplicate month/department/account row${duplicateCount === 1 ? "" : "s"}.`,
        ]
      : [];

  return {
    rows: aggregated,
    diagnostics: {
      shape,
      rowsRead: rows.length,
      rowsImported: aggregated.length,
      departments: uniqueSorted(aggregated.map((row) => row.department)),
      accounts: uniqueSorted(aggregated.map((row) => row.account)),
      months: uniqueSorted(aggregated.map((row) => row.month)),
      warnings,
    },
  };
}

function normalizeLongRows(records: CsvRecord[]): ActualRow[] {
  return records.map((record, index) => {
    const row = canonicalizeRecord(record);
    return {
      month: readMonth(row.month, index),
      department: readText(row.department, "department", index),
      account: readText(row.account, "account", index),
      value: readNumber(row.value, "value", index),
    };
  });
}

function normalizeWideRows(records: CsvRecord[]): ActualRow[] {
  const rows: ActualRow[] = [];
  records.forEach((record, index) => {
    const canonical = canonicalizeRecord(record);
    const department = readText(canonical.department, "department", index);
    const account = readText(canonical.account, "account", index);
    const monthHeaders = Object.keys(canonical).filter((header) => monthPattern.test(header));
    if (monthHeaders.length === 0) {
      throw new Error("Wide CSV must include at least one YYYY-MM monthly column.");
    }

    for (const month of monthHeaders) {
      const raw = canonical[month];
      if (raw === undefined || raw === "") {
        continue;
      }
      rows.push({
        month: readMonth(month, index),
        department,
        account,
        value: readNumber(raw, month, index),
      });
    }
  });
  return rows;
}

function aggregateRows(rows: ActualRow[]): { rows: ActualRow[]; duplicateCount: number } {
  const byKey = new Map<string, ActualRow>();
  let duplicateCount = 0;
  for (const row of rows) {
    const key = `${row.month}||${row.department}||${row.account}`;
    const existing = byKey.get(key);
    if (existing) {
      duplicateCount += 1;
      existing.value += row.value;
    } else {
      byKey.set(key, { ...row });
    }
  }
  return {
    rows: [...byKey.values()].sort(sortRows),
    duplicateCount,
  };
}

function canonicalizeRecord(record: CsvRecord): CsvRecord {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [normalizeHeader(key), value?.trim()]),
  );
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function readMonth(value: string | undefined, index: number): string {
  const month = value?.trim();
  if (!month || !monthPattern.test(month)) {
    throw new Error(`Invalid month at row ${index + 2}. Use YYYY-MM.`);
  }
  return month;
}

function readText(value: string | undefined, field: string, index: number): string {
  const text = value?.trim();
  if (!text) {
    throw new Error(`Missing ${field} at row ${index + 2}.`);
  }
  return text;
}

function readNumber(value: string | undefined, field: string, index: number): number {
  const parsed = Number(value?.replace(/[$,]/g, ""));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${field} at row ${index + 2}.`);
  }
  return parsed;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sortRows(left: ActualRow, right: ActualRow): number {
  return (
    left.month.localeCompare(right.month) ||
    left.department.localeCompare(right.department) ||
    left.account.localeCompare(right.account)
  );
}
