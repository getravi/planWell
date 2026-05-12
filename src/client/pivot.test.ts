import { describe, expect, it } from "vite-plus/test";
import type { ActualRow, DimensionMember, VarianceRow } from "../domain/types.ts";
import {
  aggregateByMonth,
  aggregateVarianceByMonth,
  buildActualGridTsv,
  buildVarianceInsights,
  describeVarianceInsight,
  formatHorizonLabel,
  getMonths,
  isMultiCellGrid,
  parseCsvRow,
  parsePastedGrid,
  pivotActualRows,
  pivotVarianceRows,
  summarizeRows,
  summarizeVarianceRows,
} from "./pivot.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function member(
  name: string,
  children: DimensionMember[] = [],
  parentName: string | null = null,
): DimensionMember {
  return { name, parentName, referenceCount: 0, children };
}

function row(month: string, department: string, account: string, value: number): ActualRow {
  return { month, department, account, value };
}

function varianceRow(
  month: string,
  department: string,
  account: string,
  leftValue: number,
  rightValue: number,
): VarianceRow {
  const variance = rightValue - leftValue;
  return {
    month,
    department,
    account,
    leftValue,
    rightValue,
    variance,
    variancePct: leftValue === 0 ? null : variance / leftValue,
  };
}

// ---------------------------------------------------------------------------
// getMonths
// ---------------------------------------------------------------------------

describe("getMonths", () => {
  it("returns sorted distinct months", () => {
    const rows = [
      row("2026-03", "A", "Revenue", 1),
      row("2026-01", "A", "Revenue", 1),
      row("2026-01", "B", "COGS", 1),
    ];
    expect(getMonths(rows)).toEqual(["2026-01", "2026-03"]);
  });

  it("returns empty for empty input", () => {
    expect(getMonths([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatHorizonLabel
// ---------------------------------------------------------------------------

describe("formatHorizonLabel", () => {
  it("returns a label spanning first to last month", () => {
    expect(formatHorizonLabel(["2026-01", "2026-06"])).toBe("Horizon 2026-01 to 2026-06");
  });

  it("returns null for empty months", () => {
    expect(formatHorizonLabel([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pivotActualRows
// ---------------------------------------------------------------------------

describe("pivotActualRows", () => {
  const rows = [
    row("2026-01", "GPU Cloud", "Revenue", 1000),
    row("2026-01", "GPU Cloud", "Revenue", 200), // should sum
    row("2026-01", "Engineering", "OpEx", 500),
  ];

  it("sums values for the same dept+account+month", () => {
    const pivoted = pivotActualRows(rows, [], []);
    const gpuRevenue = pivoted.find((r) => r.department === "GPU Cloud" && r.account === "Revenue");
    expect(gpuRevenue?.values["2026-01"]).toBe(1200);
  });

  it("adds parent rollup rows when hierarchy is provided", () => {
    const hierarchy = [member("Product", [member("GPU Cloud", [], "Product")])];
    const pivoted = pivotActualRows(rows, hierarchy, []);
    const departments = [...new Set(pivoted.map((r) => r.department))];
    expect(departments).toContain("Product");
    expect(departments).toContain("GPU Cloud");
  });

  it("marks parent rows as isParent=true", () => {
    const hierarchy = [member("Product", [member("GPU Cloud", [], "Product")])];
    const pivoted = pivotActualRows(rows, hierarchy, []);
    const product = pivoted.find((r) => r.department === "Product");
    expect(product?.isParent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pivotVarianceRows
// ---------------------------------------------------------------------------

describe("pivotVarianceRows", () => {
  const rows = [
    varianceRow("2026-01", "GPU Cloud", "Revenue", 1000, 1200),
    varianceRow("2026-01", "Engineering", "OpEx", 500, 600),
  ];

  it("creates one row per dept+account pair", () => {
    const pivoted = pivotVarianceRows(rows, [], []);
    expect(pivoted).toHaveLength(2);
  });

  it("stores variance in cell values", () => {
    const pivoted = pivotVarianceRows(rows, [], []);
    const gpuRevenue = pivoted.find((r) => r.department === "GPU Cloud" && r.account === "Revenue");
    expect(gpuRevenue?.values["2026-01"]?.variance).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// aggregateByMonth
// ---------------------------------------------------------------------------

describe("aggregateByMonth", () => {
  const rows = [
    row("2026-01", "A", "Revenue", 100),
    row("2026-01", "B", "Revenue", 200),
    row("2026-02", "A", "Revenue", 150),
    row("2026-01", "A", "OpEx", 50),
  ];

  it("sums all revenue rows for the target account by month", () => {
    const result = aggregateByMonth(rows, "Revenue");
    expect(result.find((r) => r.month === "2026-01")?.value).toBe(300);
    expect(result.find((r) => r.month === "2026-02")?.value).toBe(150);
  });

  it("excludes rows for other accounts", () => {
    const result = aggregateByMonth(rows, "Revenue");
    expect(result).toHaveLength(2); // only revenue months
  });

  it("returns sorted by month", () => {
    const result = aggregateByMonth(rows, "Revenue");
    expect(result[0].month).toBe("2026-01");
    expect(result[1].month).toBe("2026-02");
  });
});

// ---------------------------------------------------------------------------
// aggregateVarianceByMonth
// ---------------------------------------------------------------------------

describe("aggregateVarianceByMonth", () => {
  it("sums left and right values per month for the target account", () => {
    const rows = [
      varianceRow("2026-01", "A", "Revenue", 100, 120),
      varianceRow("2026-01", "B", "Revenue", 200, 250),
    ];
    const result = aggregateVarianceByMonth(rows, "Revenue");
    expect(result).toHaveLength(1);
    expect(result[0].leftValue).toBe(300);
    expect(result[0].rightValue).toBe(370);
  });
});

// ---------------------------------------------------------------------------
// summarizeRows
// ---------------------------------------------------------------------------

describe("summarizeRows", () => {
  const rows = [
    row("2026-01", "A", "Revenue", 1000),
    row("2026-01", "A", "COGS", 400),
    row("2026-01", "A", "OpEx", 200),
    row("2026-01", "A", "Headcount", 10),
  ];

  it("computes KPIs correctly", () => {
    const summary = summarizeRows(rows);
    expect(summary.kpis.revenue).toBe(1000);
    expect(summary.kpis.grossMargin).toBe(600);
    expect(summary.kpis.grossMarginPct).toBeCloseTo(0.6);
    expect(summary.kpis.opexRatio).toBeCloseTo(0.2);
    expect(summary.kpis.headcount).toBe(10);
  });

  it("sets grossMarginPct to null when revenue is 0", () => {
    const summary = summarizeRows([row("2026-01", "A", "Revenue", 0)]);
    expect(summary.kpis.grossMarginPct).toBeNull();
    expect(summary.kpis.opexRatio).toBeNull();
  });

  it("uses closing balance (last month) for headcount, not cumulative sum", () => {
    const multiMonth = [
      row("2026-01", "A", "Headcount", 10),
      row("2026-02", "A", "Headcount", 12),
      row("2026-03", "A", "Headcount", 15),
    ];
    const summary = summarizeRows(multiMonth);
    expect(summary.kpis.headcount).toBe(15);
    expect(summary.departments[0].headcount).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// summarizeVarianceRows
// ---------------------------------------------------------------------------

describe("summarizeVarianceRows", () => {
  it("treats variance as the value", () => {
    const rows = [varianceRow("2026-01", "A", "Revenue", 1000, 1200)];
    const summary = summarizeVarianceRows(rows);
    expect(summary.kpis.revenue).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// buildVarianceInsights
// ---------------------------------------------------------------------------

describe("buildVarianceInsights", () => {
  it("identifies the largest favorable change (Revenue increase)", () => {
    const rows = [
      varianceRow("2026-01", "A", "Revenue", 1000, 1200),
      varianceRow("2026-01", "A", "OpEx", 500, 600),
    ];
    const insights = buildVarianceInsights(rows);
    expect(insights.favorable?.account).toBe("Revenue");
  });

  it("identifies the largest unfavorable change (OpEx increase)", () => {
    const rows = [varianceRow("2026-01", "A", "OpEx", 500, 600)];
    const insights = buildVarianceInsights(rows);
    expect(insights.unfavorable?.account).toBe("OpEx");
  });

  it("treats Revenue decrease as unfavorable", () => {
    const rows = [varianceRow("2026-01", "A", "Revenue", 1200, 1000)];
    const insights = buildVarianceInsights(rows);
    expect(insights.unfavorable?.account).toBe("Revenue");
    expect(insights.favorable).toBeUndefined();
  });

  it("returns undefined insights when all variances are 0", () => {
    const rows = [varianceRow("2026-01", "A", "Revenue", 1000, 1000)];
    const insights = buildVarianceInsights(rows);
    expect(insights.favorable).toBeUndefined();
    expect(insights.unfavorable).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// describeVarianceInsight
// ---------------------------------------------------------------------------

describe("describeVarianceInsight", () => {
  it("describes an increase", () => {
    const insight = {
      ...varianceRow("2026-01", "A", "Revenue", 1000, 1200),
      favorability: "favorable" as const,
    };
    expect(describeVarianceInsight(insight)).toBe("Revenue increased by $200");
  });

  it("describes a decrease", () => {
    const insight = {
      ...varianceRow("2026-01", "A", "OpEx", 600, 500),
      favorability: "favorable" as const,
    };
    expect(describeVarianceInsight(insight)).toBe("OpEx decreased by $100");
  });
});

// ---------------------------------------------------------------------------
// buildActualGridTsv
// ---------------------------------------------------------------------------

describe("buildActualGridTsv", () => {
  it("produces tab-separated output with header row", () => {
    const pivotRows = [
      {
        department: "A",
        account: "Revenue",
        values: { "2026-01": 1000 },
        hierarchyLevel: 0,
        isParent: false,
      },
    ];
    const tsv = buildActualGridTsv(["2026-01"], pivotRows);
    const lines = tsv.split("\n");
    expect(lines[0]).toBe("Department\tAccount\t2026-01");
    expect(lines[1]).toBe("A\tRevenue\t1000");
  });
});

// ---------------------------------------------------------------------------
// parsePastedGrid
// ---------------------------------------------------------------------------

describe("parsePastedGrid", () => {
  it("parses TSV (tab-delimited) input", () => {
    const result = parsePastedGrid("10%\t11%\n45%\t46%");
    expect(result).toEqual([
      ["10%", "11%"],
      ["45%", "46%"],
    ]);
  });

  it("parses CSV input when no tabs are present", () => {
    const result = parsePastedGrid("10%,11%\n45%,46%");
    expect(result).toEqual([
      ["10%", "11%"],
      ["45%", "46%"],
    ]);
  });

  it("normalizes CRLF line endings", () => {
    const result = parsePastedGrid("10\r\n20");
    expect(result).toEqual([["10"], ["20"]]);
  });

  it("returns empty array for blank input", () => {
    expect(parsePastedGrid("")).toEqual([]);
    expect(parsePastedGrid("   ")).toEqual([]);
  });

  it("strips trailing newline", () => {
    const result = parsePastedGrid("10\t11\n");
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// parseCsvRow
// ---------------------------------------------------------------------------

describe("parseCsvRow", () => {
  it("splits on commas", () => {
    expect(parseCsvRow("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields", () => {
    expect(parseCsvRow('"hello, world",b')).toEqual(["hello, world", "b"]);
  });

  it("handles escaped double quotes", () => {
    expect(parseCsvRow('"say ""hi""",b')).toEqual(['say "hi"', "b"]);
  });
});

// ---------------------------------------------------------------------------
// isMultiCellGrid
// ---------------------------------------------------------------------------

describe("isMultiCellGrid", () => {
  it("returns true for multiple rows", () => {
    expect(isMultiCellGrid([["a"], ["b"]])).toBe(true);
  });

  it("returns true for a single row with multiple columns", () => {
    expect(isMultiCellGrid([["a", "b"]])).toBe(true);
  });

  it("returns false for a single cell", () => {
    expect(isMultiCellGrid([["a"]])).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isMultiCellGrid([])).toBe(false);
  });
});
