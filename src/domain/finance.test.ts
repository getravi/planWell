import { describe, expect, it } from "vite-plus/test";
import { buildForecast, compareSeries, nextMonths, resolveVarValues } from "./forecast.ts";
import { parseActualsCsv } from "./importer.ts";
import { evaluateFormula, topoSortCustomVars, CycleError } from "./formulaEngine.ts";
import type { CustomVariableDef, ScenarioAssumptions } from "./types.ts";

describe("formulaEngine sandbox", () => {
  it("blocks mathjs import() in a formula (blocked by mathjs unsafe list)", () => {
    const ctx = { base: 1000, month: 1, revenue: 1000, headcount: 20 };
    // mathjs blocks import() natively via its unsafe list — no override needed
    expect(() => evaluateFormula('import("mathjs")', ctx)).toThrow();
  });

  it("blocks createUnit in a formula", () => {
    const ctx = { base: 1000, month: 1, revenue: 1000, headcount: 20 };
    expect(() => evaluateFormula("createUnit('widget', '1 kg')", ctx)).toThrow();
  });

  it("allows normal arithmetic formulas", () => {
    const ctx = { base: 1000, month: 1, revenue: 1000, headcount: 20, revenueGrowthRate: 0.1 };
    const result = evaluateFormula("base * pow(1 + revenueGrowthRate, month)", ctx);
    expect(result).toBeCloseTo(1100, 2);
  });
});

describe("CSV actuals importer", () => {
  it("normalizes long/tidy CSV rows and aggregates duplicates", () => {
    const result = parseActualsCsv(`month,department,account,value
2025-01,GPU Cloud,Revenue,1000
2025-01,GPU Cloud,Revenue,250
2025-01,GPU Cloud,COGS,400
`);

    expect(result.rows).toEqual([
      { month: "2025-01", department: "GPU Cloud", account: "COGS", value: 400 },
      { month: "2025-01", department: "GPU Cloud", account: "Revenue", value: 1250 },
    ]);
    expect(result.diagnostics.warnings).toContain(
      "Aggregated 1 duplicate month/department/account row.",
    );
  });

  it("normalizes wide monthly CSV rows", () => {
    const result = parseActualsCsv(`department,account,2025-01,2025-02
Engineering,Headcount,40,44
Engineering,OpEx,1200000,1260000
`);

    expect(result.rows).toEqual([
      { month: "2025-01", department: "Engineering", account: "Headcount", value: 40 },
      { month: "2025-01", department: "Engineering", account: "OpEx", value: 1200000 },
      { month: "2025-02", department: "Engineering", account: "Headcount", value: 44 },
      { month: "2025-02", department: "Engineering", account: "OpEx", value: 1260000 },
    ]);
  });

  it("rejects invalid dates and missing required fields", () => {
    expect(() =>
      parseActualsCsv(`month,department,account,value
2025-13,GPU Cloud,Revenue,1000
`),
    ).toThrow(/Invalid month/);

    expect(() => parseActualsCsv("department,account,2025-01\nEngineering,,1")).toThrow(
      /Missing account/,
    );
  });
});

describe("driver-based forecasting", () => {
  const actuals = parseActualsCsv(`month,department,account,value
2025-12,GPU Cloud,Revenue,1000
2025-12,GPU Cloud,COGS,500
2025-12,GPU Cloud,Headcount,10
2025-12,GPU Cloud,OpEx,200000
2025-12,Engineering,Revenue,0
2025-12,Engineering,COGS,0
2025-12,Engineering,Headcount,20
2025-12,Engineering,OpEx,300000
`).rows;

  const builtinDefs = [
    { id: "revenueGrowthRate", label: "Revenue Growth Rate", kind: "input" as const },
    { id: "cogsPctOfRevenue", label: "COGS % of Revenue", kind: "input" as const },
    { id: "headcountGrowthRate", label: "Headcount Growth Rate", kind: "input" as const },
    { id: "costPerHead", label: "Cost per Head", kind: "input" as const },
  ];

  it("builds a 12-month forward forecast with dept monthly overrides", () => {
    const forecast = buildForecast(actuals, {
      name: "Base Case",
      varOverrides: {
        "GPU Cloud": {
          monthly: { "2026-01": { revenueGrowthRate: 0.1, cogsPctOfRevenue: 0.42, headcountGrowthRate: 0.05, costPerHead: 15000 } },
        },
        Engineering: {
          monthly: { "2026-01": { headcountGrowthRate: 0.1, costPerHead: 18000 } },
        },
      },
    }, [], undefined, builtinDefs);

    expect(forecast).toHaveLength(96);
    expect(
      forecast.find(
        (row) =>
          row.month === "2026-01" && row.department === "GPU Cloud" && row.account === "Revenue",
      )?.value,
    ).toBeCloseTo(1100);
    expect(
      forecast.find(
        (row) =>
          row.month === "2026-01" && row.department === "GPU Cloud" && row.account === "COGS",
      )?.value,
    ).toBeCloseTo(462);
    expect(
      forecast.find(
        (row) =>
          row.month === "2026-01" &&
          row.department === "Engineering" &&
          row.account === "Headcount",
      )?.value,
    ).toBeCloseTo(22);
    expect(
      forecast.find(
        (row) =>
          row.month === "2026-01" && row.department === "Engineering" && row.account === "OpEx",
      )?.value,
    ).toBeCloseTo(396000);
  });

  it("uses per-dept monthly overrides for different months", () => {
    const forecast = buildForecast(actuals, {
      name: "Monthly Plan",
      varOverrides: {
        "GPU Cloud": {
          monthly: {
            "2026-01": { revenueGrowthRate: 0.1, cogsPctOfRevenue: 0.4, headcountGrowthRate: 0.05, costPerHead: 15000 },
            "2026-02": { revenueGrowthRate: 0.5, cogsPctOfRevenue: 0.3, headcountGrowthRate: 0.08, costPerHead: 16000 },
          },
        },
        Engineering: {
          monthly: {
            "2026-01": { headcountGrowthRate: 0.2, costPerHead: 20000 },
          },
        },
      },
    }, [], undefined, builtinDefs);

    expect(
      forecast.find(
        (row) =>
          row.month === "2026-01" && row.department === "GPU Cloud" && row.account === "Revenue",
      )?.value,
    ).toBeCloseTo(1100);
    expect(
      forecast.find(
        (row) =>
          row.month === "2026-02" && row.department === "GPU Cloud" && row.account === "Revenue",
      )?.value,
    ).toBeCloseTo(2250);
    expect(
      forecast.find(
        (row) =>
          row.month === "2026-02" && row.department === "GPU Cloud" && row.account === "COGS",
      )?.value,
    ).toBeCloseTo(675);
    expect(
      forecast.find(
        (row) =>
          row.month === "2026-01" && row.department === "Engineering" && row.account === "OpEx",
      )?.value,
    ).toBeCloseTo(480000);
  });

  it("inherits driver assumptions from department hierarchy levels", () => {
    const forecast = buildForecast(
      actuals,
      {
        name: "Hierarchy Plan",
        varOverrides: {
          "Total Company": {
            monthly: {
              "2026-01": { revenueGrowthRate: 0.1, costPerHead: 12000 },
            },
          },
          Product: {
            monthly: {
              "2026-01": { cogsPctOfRevenue: 0.4 },
            },
          },
          "GPU Cloud": {
            monthly: {
              "2026-01": { revenueGrowthRate: 0.2 },
            },
          },
        },
      },
      [
        {
          name: "Total Company",
          parentName: null,
          referenceCount: 0,
          children: [
            {
              name: "Product",
              parentName: "Total Company",
              referenceCount: 0,
              children: [
                { name: "GPU Cloud", parentName: "Product", referenceCount: 0, children: [] },
              ],
            },
            { name: "Engineering", parentName: "Total Company", referenceCount: 0, children: [] },
          ],
        },
      ],
      undefined,
      builtinDefs,
    );

    expect(
      forecast.find(
        (row) =>
          row.month === "2026-01" && row.department === "GPU Cloud" && row.account === "Revenue",
      )?.value,
    ).toBeCloseTo(1200);
    expect(
      forecast.find(
        (row) =>
          row.month === "2026-01" && row.department === "GPU Cloud" && row.account === "COGS",
      )?.value,
    ).toBeCloseTo(480);
    expect(
      forecast.find(
        (row) =>
          row.month === "2026-01" && row.department === "Engineering" && row.account === "OpEx",
      )?.value,
    ).toBeCloseTo(240000);
  });

  it("compares series with dollar and percent variance", () => {
    const base = [{ month: "2026-01", department: "GPU Cloud", account: "Revenue", value: 1000 }];
    const upside = [{ month: "2026-01", department: "GPU Cloud", account: "Revenue", value: 1250 }];

    expect(compareSeries(base, upside)).toEqual([
      {
        month: "2026-01",
        department: "GPU Cloud",
        account: "Revenue",
        leftValue: 1000,
        rightValue: 1250,
        variance: 250,
        variancePct: 0.25,
      },
    ]);
  });

  describe("compareSeries", () => {
    it("handles department names containing the || delimiter", () => {
      const left = [
        { month: "2025-12", department: "Sales||Marketing", account: "Revenue", value: 1000 },
      ];
      const right = [
        { month: "2025-12", department: "Sales||Marketing", account: "Revenue", value: 1200 },
      ];
      const rows = compareSeries(left, right);
      expect(rows).toHaveLength(1);
      expect(rows[0].department).toBe("Sales||Marketing");
      expect(rows[0].variance).toBeCloseTo(200, 2);
    });

    it("correctly aggregates when left and right have different keys", () => {
      const left = [{ month: "2025-12", department: "Eng", account: "Revenue", value: 500 }];
      const right = [{ month: "2025-12", department: "Sales", account: "Revenue", value: 300 }];
      const rows = compareSeries(left, right);
      expect(rows).toHaveLength(2);
      const eng = rows.find((r) => r.department === "Eng");
      expect(eng?.leftValue).toBe(500);
      expect(eng?.rightValue).toBe(0);
      expect(eng?.variance).toBeCloseTo(-500, 2);
    });
  });

  describe("safeEvaluate fallback", () => {
    it("falls back to default formula when custom formula references undefined variable", () => {
      const actuals = [
        { month: "2025-12", department: "Eng", account: "Revenue", value: 1000 },
        { month: "2025-12", department: "Eng", account: "COGS", value: 400 },
        { month: "2025-12", department: "Eng", account: "Headcount", value: 10 },
        { month: "2025-12", department: "Eng", account: "OpEx", value: 5000 },
      ];
      const builtinDefs = [
        { id: "revenueGrowthRate", label: "Revenue Growth Rate", kind: "input" as const },
        { id: "cogsPctOfRevenue", label: "COGS % of Revenue", kind: "input" as const },
        { id: "headcountGrowthRate", label: "Headcount Growth Rate", kind: "input" as const },
        { id: "costPerHead", label: "Cost per Head", kind: "input" as const },
      ];
      const assumptions = {
        name: "Test",
        formulas: { Revenue: "nonExistentVariable * base" },
      };

      // Should not throw
      const rows = buildForecast(actuals, assumptions, [], undefined, builtinDefs);
      expect(rows.length).toBeGreaterThan(0);

      const jan = rows.find((r) => r.month === "2026-01" && r.account === "Revenue");
      // Falls back to DEFAULT_FORMULAS["Revenue"] = "base * pow(1 + revenueGrowthRate, month)"
      // With revenueGrowthRate=0 (default), month=1: base * pow(1, 1) = 1000
      expect(jan?.value).toBeCloseTo(1000, 1);
    });
  });
});

describe("nextMonths", () => {
  it("returns empty array for empty string input", () => {
    expect(nextMonths("", 12)).toEqual([]);
  });

  it("returns empty array for invalid month format", () => {
    expect(nextMonths("not-a-month", 12)).toEqual([]);
  });

  it("returns empty array for out-of-range month (month 13)", () => {
    expect(nextMonths("2025-13", 12)).toEqual([]);
  });

  it("returns 12 valid months for valid input", () => {
    const months = nextMonths("2025-12", 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-01");
    expect(months[11]).toBe("2026-12");
  });

  it("handles December to January rollover", () => {
    expect(nextMonths("2025-11", 2)).toEqual(["2025-12", "2026-01"]);
  });
});

describe("resolveVarValues precedence", () => {
  const defs: CustomVariableDef[] = [
    { id: "rate", label: "Rate", kind: "input" },
  ];
  const ancestorLookup = new Map([
    ["Child", ["Parent"]],
    ["Parent", []],
  ]);

  it("returns 0 when no overrides are set", () => {
    const result = resolveVarValues(defs, { name: "Test" }, "Child", "2025-01", 1, ancestorLookup);
    expect(result.rate).toBe(0);
  });

  it("ancestor dept monthly sets value for child dept", () => {
    const assumptions: ScenarioAssumptions = {
      name: "Test",
      varOverrides: { Parent: { monthly: { "2025-01": { rate: 0.2 } } } },
    };
    const result = resolveVarValues(defs, assumptions, "Child", "2025-01", 1, ancestorLookup);
    expect(result.rate).toBe(0.2);
  });

  it("dept monthly overrides ancestor dept monthly", () => {
    const assumptions: ScenarioAssumptions = {
      name: "Test",
      varOverrides: {
        Parent: { monthly: { "2025-01": { rate: 0.2 } } },
        Child: { monthly: { "2025-01": { rate: 0.99 } } },
      },
    };
    const result = resolveVarValues(defs, assumptions, "Child", "2025-01", 1, ancestorLookup);
    expect(result.rate).toBe(0.99);
  });

  it("evaluates calculated vars after input vars are resolved", () => {
    const calcDefs: CustomVariableDef[] = [
      { id: "rate", label: "Rate", kind: "input" },
      { id: "adjustedRate", label: "Adjusted Rate", kind: "calculated", formula: "rate * 2" },
    ];
    const noAncestors = new Map<string, string[]>([["Eng", []]]);
    const assumptions: ScenarioAssumptions = {
      name: "Test",
      varOverrides: { Eng: { monthly: { "2025-01": { rate: 0.05 } } } },
    };
    const result = resolveVarValues(calcDefs, assumptions, "Eng", "2025-01", 1, noAncestors);
    expect(result.adjustedRate).toBeCloseTo(0.1, 5);
  });

  it("multi-level ancestors: grandparent < parent < child (monthly)", () => {
    const multiDefs: CustomVariableDef[] = [
      { id: "rate", label: "Rate", kind: "input" },
    ];
    const multiAncestors = new Map<string, string[]>([
      ["GrandParent", []],
      ["Parent", ["GrandParent"]],
      ["Child", ["Parent", "GrandParent"]],
    ]);
    const assumptions: ScenarioAssumptions = {
      name: "Test",
      varOverrides: {
        GrandParent: { monthly: { "2025-01": { rate: 0.1 } } },
        Parent: { monthly: { "2025-01": { rate: 0.2 } } },
        Child: { monthly: { "2025-01": { rate: 0.3 } } },
      },
    };
    const result = resolveVarValues(multiDefs, assumptions, "Child", "2025-01", 1, multiAncestors);
    expect(result.rate).toBe(0.3);
  });
});

describe("topoSortCustomVars", () => {
  it("sorts independent calculated vars in dependency order", () => {
    const defs: CustomVariableDef[] = [
      { id: "b", label: "B", kind: "calculated", formula: "a * 2" },
      { id: "a", label: "A", kind: "calculated", formula: "1" },
    ];
    const sorted = topoSortCustomVars(defs);
    expect(sorted.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("throws CycleError for a → b → a cycle", () => {
    const defs: CustomVariableDef[] = [
      { id: "a", label: "A", kind: "calculated", formula: "b + 1" },
      { id: "b", label: "B", kind: "calculated", formula: "a + 1" },
    ];
    expect(() => topoSortCustomVars(defs)).toThrow(CycleError);
  });
});
