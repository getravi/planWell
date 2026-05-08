import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import App from "./App.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlanWell workbench UI", () => {
  it("shows login first and then exposes import and scenario comparison workflows", async () => {
    let authenticated = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        if (authenticated) {
          return json({ user: { email: "director@planwell.local" } });
        }
        return json({ error: "Authentication required." }, 401);
      }
      if (url.endsWith("/api/auth/login")) {
        authenticated = true;
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/scenarios")) {
        return json({
          scenarios: [
            {
              id: "base",
              name: "Base Case",
              assumptions: {
                name: "Base Case",
                global: {
                  revenueGrowthRate: 0.03,
                  cogsPctOfRevenue: 0.44,
                  headcountGrowthRate: 0.01,
                  costPerHead: 19000,
                },
                monthly: {
                  "2026-01": {
                    revenueGrowthRate: 0.03,
                    cogsPctOfRevenue: 0.44,
                    headcountGrowthRate: 0.01,
                    costPerHead: 19000,
                  },
                },
                overrides: {
                  Engineering: {
                    monthly: {
                      "2026-01": {
                        headcountGrowthRate: 0.02,
                      },
                    },
                  },
                },
              },
            },
            {
              id: "upside",
              name: "Aggressive Growth",
              assumptions: {
                name: "Aggressive Growth",
                global: {
                  revenueGrowthRate: 0.05,
                  cogsPctOfRevenue: 0.42,
                  headcountGrowthRate: 0.02,
                  costPerHead: 19500,
                },
                monthly: {
                  "2026-01": {
                    revenueGrowthRate: 0.05,
                    cogsPctOfRevenue: 0.42,
                    headcountGrowthRate: 0.02,
                    costPerHead: 19500,
                  },
                },
                overrides: {},
              },
            },
          ],
        });
      }
      if (url.includes("/api/cube/actuals")) {
        return json({
          rows: [],
          summary: {
            kpis: {
              revenue: 0,
              grossMargin: 0,
              grossMarginPct: null,
              opex: 0,
              opexRatio: null,
              headcount: 0,
            },
            departments: [],
            months: [],
          },
        });
      }
      if (url.includes("/api/cube/forecast")) {
        return json({
          rows: [
            { month: "2026-01", department: "GPU Cloud", account: "Revenue", value: 1000 },
            { month: "2026-01", department: "Engineering", account: "OpEx", value: 500 },
          ],
          summary: {
            kpis: {
              revenue: 0,
              grossMargin: 0,
              grossMarginPct: null,
              opex: 0,
              opexRatio: null,
              headcount: 0,
            },
            departments: [
              { department: "GPU Cloud", revenue: 1000, cogs: 400, opex: 0, headcount: 10 },
              { department: "Engineering", revenue: 0, cogs: 0, opex: 500, headcount: 20 },
            ],
            months: ["2026-01"],
          },
        });
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await screen.findByLabelText(/email/i);
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect((await screen.findAllByText("Forecast Model")).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-slot="sidebar-provider"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="sidebar"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="sidebar-inset"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="card"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: /admin/i }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(
      screen.getByRole("button", { name: /admin/i }).querySelector(".lucide-settings"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /model structure/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^dimensions$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^time settings$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^schema$/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /admin/i }));
    expect(screen.getByRole("button", { name: /admin/i }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(screen.queryByRole("button", { name: /model structure/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^dimensions$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^time settings$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^schema$/i })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /actuals/i }));
    expect(screen.getByText("Import actuals")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /scenarios/i }));
    expect(screen.getByText("Compare scenarios")).toBeTruthy();
  });

  it("exposes month-level driver grid with months as columns and hierarchy assumption levels", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/dimensions")) {
        return json({
          department: [
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
                    {
                      name: "GPU Cloud",
                      parentName: "Product",
                      referenceCount: 12,
                      children: [],
                    },
                  ],
                },
                {
                  name: "Engineering",
                  parentName: "Total Company",
                  referenceCount: 12,
                  children: [],
                },
              ],
            },
          ],
          account: [],
          time: [],
        });
      }
      if (url.endsWith("/api/scenarios")) {
        if ((input instanceof Request ? input.method : init?.method) === "POST") {
          return json({ scenario: { id: "base", name: "Base Case", assumptions: {} } });
        }
        return json({
          scenarios: [
            {
              id: "base",
              name: "Base Case",
              assumptions: {
                name: "Base Case",
                global: {
                  revenueGrowthRate: 0.03,
                  cogsPctOfRevenue: 0.44,
                  headcountGrowthRate: 0.01,
                  costPerHead: 19000,
                },
                monthly: {
                  "2026-01": {
                    revenueGrowthRate: 0.03,
                    cogsPctOfRevenue: 0.44,
                    headcountGrowthRate: 0.01,
                    costPerHead: 19000,
                  },
                  "2026-02": {
                    revenueGrowthRate: 0.04,
                    cogsPctOfRevenue: 0.43,
                    headcountGrowthRate: 0.012,
                    costPerHead: 19200,
                  },
                },
                overrides: {
                  Engineering: {
                    monthly: {
                      "2026-01": {
                        headcountGrowthRate: 0.02,
                        costPerHead: 22500,
                      },
                    },
                  },
                },
              },
            },
          ],
        });
      }
      if (url.includes("/api/cube/actuals")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/forecast")) {
        return json({
          rows: [
            { month: "2026-01", department: "GPU Cloud", account: "Revenue", value: 1000 },
            { month: "2026-01", department: "Engineering", account: "OpEx", value: 500 },
            { month: "2026-02", department: "GPU Cloud", account: "Revenue", value: 1200 },
          ],
          summary: {
            ...emptyCube().summary,
            departments: [
              { department: "GPU Cloud", revenue: 2200, cogs: 900, opex: 0, headcount: 10 },
              { department: "Engineering", revenue: 0, cogs: 0, opex: 500, headcount: 20 },
            ],
            months: ["2026-01", "2026-02"],
          },
        });
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /forecast model/i }));

    expect(
      screen
        .getByRole("heading", { name: "Driver assumptions" })
        .closest("section")
        ?.classList.contains("span-two"),
    ).toBe(true);
    const assumptionOptions = await getSelectOptions(/assumption level/i);
    expect(assumptionOptions.filter((option) => option.label === "Total Company")).toHaveLength(1);
    expect(assumptionOptions.find((option) => option.value === "__company__")).toBeUndefined();
    expect(assumptionOptions.map((option) => option.label)).toEqual([
      "Total Company",
      "Product",
      "GPU Cloud",
      "Engineering",
    ]);
    expect(screen.queryByRole("option", { name: "Company defaults" })).toBeNull();
    expect(assumptionOptions.some((option) => option.label === "Engineering")).toBe(true);
    expect(screen.getAllByRole("columnheader", { name: "2026-01" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "2026-02" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("rowheader", { name: "Revenue growth" })).toBeTruthy();

    await userEvent.clear(screen.getByLabelText("Revenue growth 2026-01"));
    await userEvent.type(screen.getByLabelText("Revenue growth 2026-01"), "9");
    await userEvent.click(screen.getByRole("button", { name: /save scenario/i }));

    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (
          !url.endsWith("/api/scenarios") ||
          init?.method !== "POST" ||
          typeof init.body !== "string"
        ) {
          return false;
        }
        const body = JSON.parse(init.body);
        return (
          body.overrides["Total Company"]?.monthly?.["2026-01"]?.revenueGrowthRate === 0.09 &&
          body.monthly?.["2026-01"]?.revenueGrowthRate === 0.03
        );
      }),
    ).toBe(true);
  });

  it("pastes Excel and CSV blocks into the Forecast Model driver grid", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/dimensions")) {
        return json({
          department: [
            { name: "Total Company", parentName: null, referenceCount: 0, children: [] },
          ],
          account: [],
          time: [],
        });
      }
      if (url.endsWith("/api/scenarios")) {
        if ((input instanceof Request ? input.method : init?.method) === "POST") {
          return json({ scenario: { id: "base", name: "Base Case", assumptions: {} } });
        }
        return json({
          scenarios: [
            {
              id: "base",
              name: "Base Case",
              assumptions: {
                name: "Base Case",
                global: {
                  revenueGrowthRate: 0.03,
                  cogsPctOfRevenue: 0.44,
                  headcountGrowthRate: 0.01,
                  costPerHead: 19000,
                },
                monthly: {},
                overrides: {},
              },
            },
          ],
        });
      }
      if (url.includes("/api/cube/actuals")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/forecast")) {
        return json({
          rows: [
            { month: "2026-01", department: "Total Company", account: "Revenue", value: 1000 },
            { month: "2026-02", department: "Total Company", account: "Revenue", value: 1200 },
          ],
          summary: { ...emptyCube().summary, months: ["2026-01", "2026-02"] },
        });
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /forecast model/i }));

    fireEvent.paste(await screen.findByLabelText("Revenue growth 2026-01"), {
      clipboardData: {
        getData: () => "10%,11%\n45%,46%",
      },
    });
    fireEvent.paste(await screen.findByLabelText("Headcount growth 2026-01"), {
      clipboardData: {
        getData: () => "2\t3\n20000\t21000",
      },
    });
    await userEvent.click(screen.getByRole("button", { name: /save scenario/i }));

    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (
          !url.endsWith("/api/scenarios") ||
          init?.method !== "POST" ||
          typeof init.body !== "string"
        ) {
          return false;
        }
        const body = JSON.parse(init.body);
        const override = body.overrides["Total Company"]?.monthly;
        return (
          override?.["2026-01"]?.revenueGrowthRate === 0.1 &&
          override?.["2026-02"]?.revenueGrowthRate === 0.11 &&
          override?.["2026-01"]?.cogsPctOfRevenue === 0.45 &&
          override?.["2026-02"]?.cogsPctOfRevenue === 0.46 &&
          override?.["2026-01"]?.headcountGrowthRate === 0.02 &&
          override?.["2026-02"]?.headcountGrowthRate === 0.03 &&
          override?.["2026-01"]?.costPerHead === 20000 &&
          override?.["2026-02"]?.costPerHead === 21000
        );
      }),
    ).toBe(true);
  });

  it("filters Forecast Model by department and uses month-column spreadsheet grids", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/scenarios")) {
        return json({
          scenarios: [
            {
              id: "base",
              name: "Base Case",
              assumptions: {
                name: "Base Case",
                global: {
                  revenueGrowthRate: 0.03,
                  cogsPctOfRevenue: 0.44,
                  headcountGrowthRate: 0.01,
                  costPerHead: 19000,
                },
                monthly: {
                  "2026-01": {
                    revenueGrowthRate: 0.03,
                    cogsPctOfRevenue: 0.44,
                    headcountGrowthRate: 0.01,
                    costPerHead: 19000,
                  },
                  "2026-02": {
                    revenueGrowthRate: 0.04,
                    cogsPctOfRevenue: 0.43,
                    headcountGrowthRate: 0.012,
                    costPerHead: 19200,
                  },
                },
                overrides: {},
              },
            },
          ],
        });
      }
      if (url.includes("/api/cube/actuals")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/forecast")) {
        return json({
          rows: [
            { month: "2026-01", department: "GPU Cloud", account: "Revenue", value: 1000 },
            { month: "2026-02", department: "GPU Cloud", account: "Revenue", value: 1200 },
            { month: "2026-01", department: "Engineering", account: "OpEx", value: 500 },
          ],
          summary: {
            ...emptyCube().summary,
            departments: [
              { department: "GPU Cloud", revenue: 2200, cogs: 900, opex: 0, headcount: 10 },
              { department: "Engineering", revenue: 0, cogs: 0, opex: 500, headcount: 20 },
            ],
            months: ["2026-01", "2026-02"],
          },
        });
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const department = await screen.findByLabelText(/forecast department/i);
    expect(department).toBeTruthy();
    await chooseSelectOption(/forecast department/i, "GPU Cloud");
    expect(screen.getAllByRole("columnheader", { name: "2026-01" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "2026-02" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Horizon 2026-01 to 2026-02")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /copy grid/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("rowheader", { name: "Engineering" })).toBeNull();
  });

  it("syncs Forecast Model department filters with dimensions hierarchy", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/dimensions")) {
        return json({
          department: [
            {
              name: "Product",
              parentName: null,
              referenceCount: 0,
              children: [
                { name: "GPU Cloud", parentName: "Product", referenceCount: 12, children: [] },
                { name: "New Ventures", parentName: "Product", referenceCount: 0, children: [] },
              ],
            },
          ],
          account: [],
          time: [],
        });
      }
      if (url.endsWith("/api/scenarios")) {
        return json({
          scenarios: [
            {
              id: "base",
              name: "Base Case",
              assumptions: {
                name: "Base Case",
                global: {
                  revenueGrowthRate: 0.03,
                  cogsPctOfRevenue: 0.44,
                  headcountGrowthRate: 0.01,
                  costPerHead: 19000,
                },
                monthly: {},
                overrides: {},
              },
            },
          ],
        });
      }
      if (url.includes("/api/cube/actuals")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/forecast")) {
        return json({
          rows: [
            { month: "2026-01", department: "GPU Cloud", account: "Revenue", value: 1000 },
            { month: "2026-01", department: "Engineering", account: "OpEx", value: 500 },
          ],
          summary: {
            ...emptyCube().summary,
            departments: [
              { department: "GPU Cloud", revenue: 1000, cogs: 0, opex: 0, headcount: 0 },
              { department: "Engineering", revenue: 0, cogs: 0, opex: 500, headcount: 0 },
            ],
          },
        });
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const department = await screen.findByLabelText(/forecast department/i);
    expect(department).toBeTruthy();
    const departmentOptions = await getSelectOptions(/forecast department/i);
    expect(departmentOptions.some((option) => option.label === "Product")).toBe(true);
    expect(departmentOptions.some((option) => option.label === "New Ventures")).toBe(true);

    await chooseSelectOption(/forecast department/i, "Product");
    expect(await screen.findAllByRole("rowheader", { name: "Product" })).not.toHaveLength(0);
    expect(
      screen
        .getAllByRole("rowheader", { name: "Product" })[0]
        .closest("tr")
        ?.classList.contains("department-rollup-row"),
    ).toBe(true);
    expect(await screen.findByRole("rowheader", { name: "GPU Cloud" })).toBeTruthy();
    expect(screen.queryByRole("rowheader", { name: "Engineering" })).toBeNull();
    expect(
      (await getSelectOptions(/forecast department/i)).some(
        (option) => option.label === "New Ventures",
      ),
    ).toBe(true);
  });

  it("shows parent department rows in variance tables", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/dimensions")) {
        return json({
          department: [
            {
              name: "Product",
              parentName: null,
              referenceCount: 0,
              children: [
                { name: "GPU Cloud", parentName: "Product", referenceCount: 12, children: [] },
              ],
            },
          ],
          account: [],
          time: [],
        });
      }
      if (url.endsWith("/api/scenarios")) {
        return json({
          scenarios: [
            {
              id: "base",
              name: "Base Case",
              assumptions: { name: "Base Case", global: baseDrivers(), monthly: {}, overrides: {} },
            },
            {
              id: "upside",
              name: "Aggressive Growth",
              assumptions: {
                name: "Aggressive Growth",
                global: baseDrivers(),
                monthly: {},
                overrides: {},
              },
            },
          ],
        });
      }
      if (url.includes("/api/cube/actuals") || url.includes("/api/cube/forecast")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/variance")) {
        return json({
          rows: [
            {
              month: "2026-01",
              department: "GPU Cloud",
              account: "Revenue",
              leftValue: 1000,
              rightValue: 1200,
              variance: 200,
              variancePct: 0.2,
            },
            {
              month: "2026-01",
              department: "GPU Cloud",
              account: "OpEx",
              leftValue: 500,
              rightValue: 650,
              variance: 150,
              variancePct: 0.3,
            },
          ],
        });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /variance/i }));

    expect(await screen.findAllByRole("rowheader", { name: "Product" })).not.toHaveLength(0);
    expect(
      screen
        .getAllByRole("rowheader", { name: "Product" })[0]
        .closest("tr")
        ?.classList.contains("department-rollup-row"),
    ).toBe(true);
    expect(screen.getAllByRole("rowheader", { name: "GPU Cloud" })).not.toHaveLength(0);
    expect(screen.getByText("Largest favorable change")).toBeTruthy();
    expect(screen.getByText("Revenue increased by $200")).toBeTruthy();
    expect(screen.getByText("Largest unfavorable change")).toBeTruthy();
    expect(screen.getByText("OpEx increased by $150")).toBeTruthy();
  });

  it("hides the compare selector on Forecast Model and shows it on comparison pages", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/scenarios")) {
        return json({
          scenarios: [
            {
              id: "base",
              name: "Base Case",
              assumptions: {
                name: "Base Case",
                global: {
                  revenueGrowthRate: 0.03,
                  cogsPctOfRevenue: 0.44,
                  headcountGrowthRate: 0.01,
                  costPerHead: 19000,
                },
                monthly: {},
                overrides: {},
              },
            },
            {
              id: "upside",
              name: "Aggressive Growth",
              assumptions: {
                name: "Aggressive Growth",
                global: {
                  revenueGrowthRate: 0.05,
                  cogsPctOfRevenue: 0.42,
                  headcountGrowthRate: 0.02,
                  costPerHead: 19500,
                },
                monthly: {},
                overrides: {},
              },
            },
          ],
        });
      }
      if (url.includes("/api/cube/actuals")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/forecast")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByText("Driver assumptions");
    expect(screen.queryByText("Compare to")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /scenarios/i }));
    expect(await screen.findByText("Compare to")).toBeTruthy();
  });

  it("sends the comparison scenario to the grounded analyst", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/dimensions")) {
        return json({ department: [], account: [], time: [] });
      }
      if (url.endsWith("/api/scenarios")) {
        return json({
          scenarios: [
            {
              id: "base",
              name: "Base Case",
              assumptions: { name: "Base Case", global: baseDrivers(), monthly: {}, overrides: {} },
            },
            {
              id: "upside",
              name: "Aggressive Growth",
              assumptions: {
                name: "Aggressive Growth",
                global: baseDrivers(),
                monthly: {},
                overrides: {},
              },
            },
          ],
        });
      }
      if (url.includes("/api/cube/actuals") || url.includes("/api/cube/forecast")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      if (url.endsWith("/api/analyst/ask")) {
        return json({
          answer: "Base Case vs Aggressive Growth: largest variance is Revenue.",
          provider: "local",
          citations: [{ tool: "compareScenarios", label: "Revenue", value: 100 }],
        });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /analyst/i }));
    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "What changed?");
    await userEvent.click(screen.getByRole("button", { name: /ask analyst/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = input instanceof Request ? input.url : input.toString();
          if (
            !url.endsWith("/api/analyst/ask") ||
            init?.method !== "POST" ||
            typeof init.body !== "string"
          ) {
            return false;
          }
          const body = JSON.parse(init.body);
          return body.scenario === "Base Case" && body.compareScenario === "Aggressive Growth";
        }),
      ).toBe(true);
    });
  });

  it("edits dimensions and confirms destructive deletes", async () => {
    let dimensions = {
      department: [
        {
          name: "Product",
          parentName: null,
          referenceCount: 0,
          children: [
            { name: "GPU Cloud", parentName: "Product", referenceCount: 12, children: [] },
          ],
        },
      ],
      account: [{ name: "Revenue", parentName: null, referenceCount: 12, children: [] }],
      time: [
        {
          name: "2026",
          parentName: null,
          referenceCount: 1,
          children: [
            {
              name: "2026 Q1",
              parentName: "2026",
              referenceCount: 1,
              children: [
                { name: "2026-01", parentName: "2026 Q1", referenceCount: 1, children: [] },
              ],
            },
          ],
        },
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/dimensions")) {
        return json(dimensions);
      }
      if (
        url.includes("/api/dimensions/department/members/GPU%20Cloud/impact") ||
        url.includes("/api/dimensions/department/members/Cloud%20AI/impact")
      ) {
        return json({
          impact: { actualRows: 1, forecastRows: 12, scenarioOverrides: 0, childCount: 0 },
        });
      }
      if (
        url.includes("/api/dimensions/department/members/GPU%20Cloud") ||
        url.includes("/api/dimensions/department/members/Cloud%20AI")
      ) {
        if (init?.method === "PATCH") {
          dimensions = {
            ...dimensions,
            department: [
              {
                name: "Product",
                parentName: null,
                referenceCount: 0,
                children: [
                  { name: "Cloud AI", parentName: "Product", referenceCount: 12, children: [] },
                ],
              },
            ],
          };
          return json({ dimensions });
        }
        if (init?.method === "DELETE") {
          return json({
            ok: true,
            impact: { actualRows: 1, forecastRows: 12, scenarioOverrides: 0, childCount: 0 },
            dimensions,
          });
        }
      }
      if (url.endsWith("/api/scenarios")) {
        return json({ scenarios: [] });
      }
      if (url.includes("/api/cube/actuals")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/forecast")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openAdminPage(/^dimensions$/i);

    expect(await screen.findByRole("tab", { name: "Departments" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Accounts" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Time" })).toBeNull();

    await openAdminPage(/^time settings$/i);
    expect(screen.getByRole("heading", { name: "Time Settings", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Time tree" })).toBeTruthy();
    expect(document.querySelector(".time-settings-layout")).toBeTruthy();
    expect(document.querySelector(".time-tree-panel")).toBeTruthy();
    expect(document.querySelector(".time-tree-header")).toBeTruthy();
    expect(document.querySelector(".time-tree-scroll")).toBeTruthy();
    expect(screen.getByText("Month or year")).toBeTruthy();
    expect(screen.getByPlaceholderText("2027 or 2027-01")).toBeTruthy();
    await openAdminPage(/^dimensions$/i);

    await userEvent.click(screen.getByRole("button", { name: /select gpu cloud/i }));
    await userEvent.clear(screen.getByLabelText("Member name"));
    await userEvent.type(screen.getByLabelText("Member name"), "Cloud AI");
    await userEvent.click(screen.getByRole("button", { name: /save member/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dimensions/department/members/GPU%20Cloud",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Cloud AI", parentName: "Product" }),
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: /select cloud ai/i }));
    await userEvent.click(screen.getByRole("button", { name: /delete member/i }));
    expect(await screen.findByText(/1 actual rows/i)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /delete anyway/i }));

    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        return (
          url.includes("/api/dimensions/department/members/Cloud%20AI?force=1") &&
          (init as RequestInit | undefined)?.method === "DELETE"
        );
      }),
    ).toBe(true);
  });

  it("reorders sibling dimension members from Dimensions", async () => {
    const reorderedDimensions = {
      department: [
        {
          name: "Product",
          parentName: null,
          sortOrder: 0,
          referenceCount: 0,
          children: [
            {
              name: "GPU Cloud",
              parentName: "Product",
              sortOrder: 0,
              referenceCount: 12,
              children: [],
            },
            {
              name: "Inference Platform",
              parentName: "Product",
              sortOrder: 1,
              referenceCount: 0,
              children: [],
            },
          ],
        },
      ],
      account: [],
      time: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/dimensions")) {
        return json({
          department: [
            {
              name: "Product",
              parentName: null,
              sortOrder: 0,
              referenceCount: 0,
              children: [
                {
                  name: "Inference Platform",
                  parentName: "Product",
                  sortOrder: 0,
                  referenceCount: 0,
                  children: [],
                },
                {
                  name: "GPU Cloud",
                  parentName: "Product",
                  sortOrder: 1,
                  referenceCount: 12,
                  children: [],
                },
              ],
            },
          ],
          account: [],
          time: [],
        });
      }
      if (url.endsWith("/api/scenarios")) {
        return json({ scenarios: [] });
      }
      if (url.includes("/api/cube/actuals") || url.includes("/api/cube/forecast")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      if (url.includes("/api/dimensions/department/members/GPU%20Cloud")) {
        return json({ dimensions: reorderedDimensions });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openAdminPage(/^dimensions$/i);
    await userEvent.click(await screen.findByRole("button", { name: /select gpu cloud/i }));
    const dataTransfer = {
      clearData: vi.fn(),
      getData: vi.fn(() => "GPU Cloud"),
      setData: vi.fn(),
    };
    fireEvent.dragStart(screen.getByRole("button", { name: /select gpu cloud/i }), {
      dataTransfer,
    });
    fireEvent.dragOver(screen.getByRole("button", { name: /select inference platform/i }), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByRole("button", { name: /select inference platform/i }), {
      dataTransfer,
    });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = input instanceof Request ? input.url : input.toString();
          if (
            !url.includes("/api/dimensions/department/members/GPU%20Cloud") ||
            init?.method !== "PATCH" ||
            typeof init.body !== "string"
          ) {
            return false;
          }
          return JSON.parse(init.body).sortOrder === -0.5;
        }),
      ).toBe(true),
    );
    const orderStatuses = await screen.findAllByText("Member order updated.");
    expect(
      orderStatuses.some((status) =>
        status.closest("section")?.textContent?.includes("Department tree"),
      ),
    ).toBe(true);
    const treeNodes = screen
      .getAllByRole("button", { name: /select/i })
      .map((button) => button.textContent);
    expect(treeNodes).toEqual(["Product0 refs", "GPU Cloud12 refs", "Inference Platform0 refs"]);
  });

  it("shows dragged member order immediately while moving a sibling downward", async () => {
    const reorderedDimensions = {
      department: [
        {
          name: "Product",
          parentName: null,
          sortOrder: 0,
          referenceCount: 0,
          children: [
            {
              name: "GPU Cloud",
              parentName: "Product",
              sortOrder: 0,
              referenceCount: 12,
              children: [],
            },
            {
              name: "Inference Platform",
              parentName: "Product",
              sortOrder: 1,
              referenceCount: 0,
              children: [],
            },
          ],
        },
      ],
      account: [],
      time: [],
    };
    let resolvePatch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/dimensions")) {
        return json({
          department: [
            {
              name: "Product",
              parentName: null,
              sortOrder: 0,
              referenceCount: 0,
              children: [
                {
                  name: "Inference Platform",
                  parentName: "Product",
                  sortOrder: 0,
                  referenceCount: 0,
                  children: [],
                },
                {
                  name: "GPU Cloud",
                  parentName: "Product",
                  sortOrder: 1,
                  referenceCount: 12,
                  children: [],
                },
              ],
            },
          ],
          account: [],
          time: [],
        });
      }
      if (url.endsWith("/api/scenarios")) {
        return json({ scenarios: [] });
      }
      if (url.includes("/api/cube/actuals") || url.includes("/api/cube/forecast")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      if (url.includes("/api/dimensions/department/members/Inference%20Platform")) {
        return new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openAdminPage(/^dimensions$/i);
    const dataTransfer = {
      clearData: vi.fn(),
      getData: vi.fn(() => "Inference Platform"),
      setData: vi.fn(),
    };
    fireEvent.dragStart(screen.getByRole("button", { name: /select inference platform/i }), {
      dataTransfer,
    });
    fireEvent.dragOver(screen.getByRole("button", { name: /select gpu cloud/i }), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByRole("button", { name: /select gpu cloud/i }), {
      dataTransfer,
    });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = input instanceof Request ? input.url : input.toString();
          if (
            !url.includes("/api/dimensions/department/members/Inference%20Platform") ||
            init?.method !== "PATCH" ||
            typeof init.body !== "string"
          ) {
            return false;
          }
          return JSON.parse(init.body).sortOrder === 1.5;
        }),
      ).toBe(true),
    );
    const optimisticTreeNodes = screen
      .getAllByRole("button", { name: /select/i })
      .map((button) => button.textContent);
    expect(optimisticTreeNodes).toEqual([
      "Product0 refs",
      "GPU Cloud12 refs",
      "Inference Platform0 refs",
    ]);

    resolvePatch?.(json({ dimensions: reorderedDimensions }));
    expect(await screen.findAllByText("Member order updated.")).toBeTruthy();
  });

  it("reorders sibling dimension members with pointer dragging", async () => {
    const reorderedDimensions = {
      department: [
        {
          name: "Product",
          parentName: null,
          sortOrder: 0,
          referenceCount: 0,
          children: [
            {
              name: "G&A",
              parentName: "Product",
              sortOrder: 0,
              referenceCount: 0,
              children: [],
            },
            {
              name: "Engineering",
              parentName: "Product",
              sortOrder: 1,
              referenceCount: 12,
              children: [],
            },
          ],
        },
      ],
      account: [],
      time: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/dimensions")) {
        return json({
          department: [
            {
              name: "Product",
              parentName: null,
              sortOrder: 0,
              referenceCount: 0,
              children: [
                {
                  name: "Engineering",
                  parentName: "Product",
                  sortOrder: 0,
                  referenceCount: 12,
                  children: [],
                },
                {
                  name: "G&A",
                  parentName: "Product",
                  sortOrder: 1,
                  referenceCount: 0,
                  children: [],
                },
              ],
            },
          ],
          account: [],
          time: [],
        });
      }
      if (url.endsWith("/api/scenarios")) {
        return json({ scenarios: [] });
      }
      if (url.includes("/api/cube/actuals") || url.includes("/api/cube/forecast")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      if (url.includes("/api/dimensions/department/members/Engineering")) {
        return json({ dimensions: reorderedDimensions });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openAdminPage(/^dimensions$/i);
    const engineering = screen.getByRole("button", { name: /select engineering/i });
    const ga = screen.getByRole("button", { name: /select g&a/i });
    const originalElementFromPoint = document.elementFromPoint?.bind(document);
    document.elementFromPoint = vi.fn(() => ga);
    fireEvent.pointerDown(engineering, { clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(engineering, { clientX: 30, clientY: 48, pointerId: 1 });
    fireEvent.pointerUp(engineering, { clientX: 30, clientY: 48, pointerId: 1 });
    if (originalElementFromPoint) {
      document.elementFromPoint = originalElementFromPoint;
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = input instanceof Request ? input.url : input.toString();
          if (
            !url.includes("/api/dimensions/department/members/Engineering") ||
            init?.method !== "PATCH" ||
            typeof init.body !== "string"
          ) {
            return false;
          }
          return JSON.parse(init.body).sortOrder === 1.5;
        }),
      ).toBe(true),
    );
    const treeNodes = screen
      .getAllByRole("button", { name: /select/i })
      .map((button) => button.textContent);
    expect(treeNodes).toEqual(["Product0 refs", "G&A0 refs", "Engineering12 refs"]);
  });

  it("shows a dimensions load error instead of an empty tree", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/dimensions")) {
        return json({ error: "Not found" }, 404);
      }
      if (url.endsWith("/api/scenarios")) {
        return json({ scenarios: [] });
      }
      if (url.includes("/api/cube/actuals")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/forecast")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openAdminPage(/^dimensions$/i);

    expect(await screen.findByText("Could not load dimensions")).toBeTruthy();
    expect(screen.getByText("Not found")).toBeTruthy();
    expect(screen.queryByText("No members yet")).toBeNull();
  });

  it("shows an HTML ERD-style database schema page", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/scenarios")) {
        return json({ scenarios: [] });
      }
      if (url.includes("/api/cube/actuals")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/forecast")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openAdminPage(/^schema$/i);

    expect(screen.getByRole("heading", { name: "Schema" })).toBeTruthy();
    expect(screen.getByText("time_month")).toBeTruthy();
    expect(screen.getAllByText("actuals").length).toBeGreaterThan(0);
    expect(screen.getAllByText("forecast_values").length).toBeGreaterThan(0);
    expect(screen.getByText("driver_assumptions")).toBeTruthy();
    expect(screen.getAllByText("versions").length).toBeGreaterThan(0);
    expect(screen.getByText("kind")).toBeTruthy();
    expect(screen.getByText("actuals or scenario")).toBeTruthy();
    expect(
      screen
        .queryAllByText("scenarios")
        .filter((element) => element.tagName.toLowerCase() === "header"),
    ).toHaveLength(0);
    expect(screen.queryByText("assumptions_json")).toBeNull();
    expect(screen.getByText("scope_type")).toBeTruthy();
    expect(screen.getByText("driver_key")).toBeTruthy();
    expect(screen.getAllByText("parent_name").length).toBeGreaterThan(0);
    expect(screen.getAllByText("sort_order").length).toBeGreaterThan(0);
    expect(screen.getByText("Derived time hierarchy")).toBeTruthy();
    expect(screen.getAllByText("Versions").length).toBeGreaterThan(0);
    expect(screen.getByText("Scenarios are versions with kind = scenario")).toBeTruthy();
    expect(screen.getByText("Everything other than Actuals is a scenario version")).toBeTruthy();
    const versionsTable = screen
      .getAllByText("versions")
      .find((element) => element.tagName.toLowerCase() === "header");
    expect(versionsTable?.closest(".erd-lane")?.querySelector(".lane-label")?.textContent).toBe(
      "Dimensions",
    );
    expect(screen.getAllByText("scenario_id -> versions.id").length).toBeGreaterThan(0);
    expect(screen.getByText("Hierarchy level assumptions")).toBeTruthy();
    expect(screen.getByText("Driver assumptions")).toBeTruthy();
    expect(screen.getByLabelText("ERD relationship lines")).toBeTruthy();
  });

  it("manages versions under Admin while protecting Actuals", async () => {
    let versions = [
      {
        id: "actuals",
        name: "Actuals",
        kind: "actuals",
        canRename: false,
        canDelete: false,
      },
      {
        id: "base",
        name: "Base Case",
        kind: "scenario",
        canRename: true,
        canDelete: true,
      },
    ];
    let resolveDelete: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/scenarios")) {
        return json({ scenarios: [] });
      }
      if (url.endsWith("/api/versions")) {
        if (init?.method === "POST") {
          const version = {
            id: "board",
            name: "Board Case",
            kind: "scenario",
            canRename: true,
            canDelete: true,
          };
          return json({ version, versions: [...versions, version] }, 201);
        }
        return json({ versions });
      }
      if (url.endsWith("/api/versions/board") && init?.method === "PATCH") {
        versions = [
          ...versions,
          {
            id: "board",
            name: "Operating Plan",
            kind: "scenario",
            canRename: true,
            canDelete: true,
          },
        ];
        return json({ version: versions[2], versions });
      }
      if (url.endsWith("/api/versions/board") && init?.method === "DELETE") {
        return new Promise<Response>((resolve) => {
          resolveDelete = (response) => {
            versions = versions.filter((version) => version.id !== "board");
            resolve(response);
          };
        });
      }
      if (url.includes("/api/cube/actuals")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/forecast")) {
        return json(emptyCube());
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await openAdminPage(/^versions$/i);

    expect(screen.getByRole("heading", { name: "Versions", level: 1 })).toBeTruthy();
    expect(document.querySelector('[data-slot="data-table"]')).toBeTruthy();
    expect(screen.getByRole("table", { name: /all versions/i })).toBeTruthy();
    expect((await screen.findAllByText("Actuals")).length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: /delete actuals/i })).toBeNull();
    expect(screen.queryByLabelText("New version name")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /add version/i }));
    expect(screen.getByRole("dialog", { name: /add version/i })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("New version name"), "Board Case");
    await chooseSelectOption("Copy data from", "actuals");
    await userEvent.click(screen.getByRole("button", { name: /create version/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/versions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Board Case", sourceId: "actuals" }),
      }),
    );
    expect(screen.queryByRole("dialog", { name: /add version/i })).toBeNull();
    expect(screen.getByLabelText("Version name Board Case")).toBeTruthy();

    await userEvent.clear(await screen.findByLabelText("Version name Board Case"));
    await userEvent.type(screen.getByLabelText("Version name Board Case"), "Operating Plan");
    expect(screen.queryByRole("button", { name: /save board case/i })).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/versions/board",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Operating Plan" }),
      }),
    );

    await userEvent.click(await screen.findByRole("button", { name: /delete operating plan/i }));
    expect(screen.getByRole("dialog", { name: /delete operating plan/i })).toBeTruthy();
    expect(
      screen.getByText(/permanently delete forecast values and driver assumptions/i),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/versions/board",
      expect.objectContaining({ method: "DELETE" }),
    );

    await userEvent.click(screen.getByRole("button", { name: /delete version/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/versions/board",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(screen.queryByLabelText("Version name Operating Plan")).toBeNull();
    resolveDelete?.(
      json({ ok: true, versions: versions.filter((version) => version.id !== "board") }),
    );
  });
});

async function openAdminPage(name: RegExp): Promise<void> {
  const admin = await screen.findByRole("button", { name: /admin/i });
  if (admin.getAttribute("aria-expanded") !== "true") {
    await userEvent.click(admin);
  }
  await userEvent.click(await screen.findByRole("button", { name }));
}

async function getSelectOptions(
  label: string | RegExp,
): Promise<{ label: string; value: string }[]> {
  const trigger = await screen.findByRole("combobox", { name: label });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    await userEvent.click(trigger);
  }
  const options = await screen.findAllByRole("option");
  const values = options.map((option) => ({
    label: option.textContent?.trim() ?? "",
    value: option.getAttribute("data-value") ?? "",
  }));
  await userEvent.keyboard("{Escape}");
  return values;
}

async function chooseSelectOption(
  label: string | RegExp,
  optionValueOrLabel: string,
): Promise<void> {
  const trigger = await screen.findByRole("combobox", { name: label });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    await userEvent.click(trigger);
  }
  const options = await screen.findAllByRole("option");
  const option = options.find(
    (item) =>
      item.getAttribute("data-value") === optionValueOrLabel ||
      item.textContent?.trim() === optionValueOrLabel,
  );
  if (!option) {
    throw new Error(`Could not find select option ${optionValueOrLabel}`);
  }
  await userEvent.click(option);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyCube() {
  return {
    rows: [],
    summary: {
      kpis: {
        revenue: 0,
        grossMargin: 0,
        grossMarginPct: null,
        opex: 0,
        opexRatio: null,
        headcount: 0,
      },
      accounts: [],
      departments: [],
      months: [],
    },
  };
}

function baseDrivers() {
  return {
    revenueGrowthRate: 0.03,
    cogsPctOfRevenue: 0.44,
    headcountGrowthRate: 0.01,
    costPerHead: 19000,
  };
}
