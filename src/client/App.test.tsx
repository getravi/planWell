import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import App, { queryClient } from "./App.tsx";

afterEach(() => {
  cleanup();
  queryClient.clear();
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
                varGlobal: {
                  revenueGrowthRate: 0.03,
                  cogsPctOfRevenue: 0.44,
                  headcountGrowthRate: 0.01,
                  costPerHead: 19000,
                },
                varMonthly: {
                  "2026-01": {
                    revenueGrowthRate: 0.03,
                    cogsPctOfRevenue: 0.44,
                    headcountGrowthRate: 0.01,
                    costPerHead: 19000,
                  },
                },
                varOverrides: {
                  "Total Company": {
                    monthly: {
                      "2026-01": {
                        revenueGrowthRate: 0.03,
                        cogsPctOfRevenue: 0.44,
                        headcountGrowthRate: 0.01,
                        costPerHead: 19000,
                      },
                    },
                  },
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
                varGlobal: {
                  revenueGrowthRate: 0.05,
                  cogsPctOfRevenue: 0.42,
                  headcountGrowthRate: 0.02,
                  costPerHead: 19500,
                },
                varMonthly: {
                  "2026-01": {
                    revenueGrowthRate: 0.05,
                    cogsPctOfRevenue: 0.42,
                    headcountGrowthRate: 0.02,
                    costPerHead: 19500,
                  },
                },
                varOverrides: {},
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
      if (url.includes("/api/custom-variables")) {
        return json({ customVariables: builtinVars() });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await screen.findByLabelText(/email/i);
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect((await screen.findAllByText("Forecast Model")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/planwell \/ modeling workbench/i)).toBeNull();
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
    await userEvent.click(screen.getByRole("button", { name: /^data integration$/i }));
    expect(screen.getByText("Import actuals")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^scenarios$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^variance$/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /scenario comparison/i }));
    expect(screen.getByText("Compare scenarios")).toBeTruthy();
    expect(screen.getByText("Variance analysis")).toBeTruthy();
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
                varGlobal: {
                  revenueGrowthRate: 0.03,
                  cogsPctOfRevenue: 0.44,
                  headcountGrowthRate: 0.01,
                  costPerHead: 19000,
                },
                varMonthly: {
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
                varOverrides: {
                  "Total Company": {
                    monthly: {
                      "2026-01": {
                        revenueGrowthRate: 0.03,
                        cogsPctOfRevenue: 0.44,
                        headcountGrowthRate: 0.01,
                        costPerHead: 19000,
                      },
                    },
                  },
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
      if (url.includes("/api/custom-variables")) {
        return json({ customVariables: builtinVars() });
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
    const departmentOptions = await getSelectOptions(/forecast department/i);
    expect(departmentOptions.map((option) => option.label)).toEqual([
      "Total Company",
      "Product",
      "GPU Cloud",
      "Engineering",
    ]);
    expect(departmentOptions.find((option) => option.label === "Total Company")?.depth).toBe("0");
    expect(departmentOptions.find((option) => option.label === "Product")?.depth).toBe("1");
    expect(departmentOptions.find((option) => option.label === "GPU Cloud")?.depth).toBe("2");
    expect(screen.queryByRole("option", { name: "Company defaults" })).toBeNull();
    expect(screen.getAllByRole("columnheader", { name: "2026-01" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "2026-02" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("rowheader", { name: "Revenue Growth Rate" })).toBeTruthy();

    const revenueGrowth = (await screen.findByLabelText(
      "Revenue Growth Rate 2026-01",
    )) as HTMLInputElement;
    expect(revenueGrowth.type).toBe("text");
    expect(revenueGrowth.value).toBe("3.00%");
    await userEvent.click(revenueGrowth);
    expect(revenueGrowth.value).toBe("0.03");
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByLabelText("Revenue Growth Rate 2026-02"));

    await userEvent.click(revenueGrowth);
    await userEvent.clear(revenueGrowth);
    await userEvent.type(revenueGrowth, "0.09");
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
        return body.varOverrides["Total Company"]?.monthly?.["2026-01"]?.revenueGrowthRate === 0.09;
      }),
    ).toBe(true);
  });

  it("calculates Forecast Model driver assumptions from actuals for selected actual years", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/settings")) {
        return json({
          forecastHorizon: 12,
          aiModel: null,
          lastActualsMonth: "2025-12",
        });
      }
      if (url.endsWith("/api/dimensions")) {
        return json({
          department: [
            {
              name: "Product",
              parentName: null,
              referenceCount: 0,
              children: [
                {
                  name: "GPU Cloud",
                  parentName: "Product",
                  referenceCount: 8,
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
        return json({
          scenarios: [
            {
              id: "base",
              name: "Base Case",
              locked: false,
              assumptions: {
                name: "Base Case",
                varOverrides: {
                  "GPU Cloud": {
                    monthly: {
                      "2025-02": {
                        revenueGrowthRate: 0.03,
                        cogsPctOfRevenue: 0.44,
                        headcountGrowthRate: 0.01,
                        costPerHead: 19000,
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
        return json({
          rows: [
            { month: "2025-01", department: "GPU Cloud", account: "Revenue", value: 100 },
            { month: "2025-01", department: "GPU Cloud", account: "COGS", value: 60 },
            { month: "2025-01", department: "GPU Cloud", account: "Headcount", value: 8 },
            { month: "2025-01", department: "GPU Cloud", account: "OpEx", value: 160 },
            { month: "2025-02", department: "GPU Cloud", account: "Revenue", value: 120 },
            { month: "2025-02", department: "GPU Cloud", account: "COGS", value: 60 },
            { month: "2025-02", department: "GPU Cloud", account: "Headcount", value: 12 },
            { month: "2025-02", department: "GPU Cloud", account: "OpEx", value: 240 },
          ],
          summary: {
            ...emptyCube().summary,
            months: ["2025-01", "2025-02"],
          },
        });
      }
      if (url.includes("/api/cube/forecast")) {
        return json({
          rows: [{ month: "2026-01", department: "GPU Cloud", account: "Revenue", value: 130 }],
          summary: {
            ...emptyCube().summary,
            departments: [
              { department: "GPU Cloud", revenue: 130, cogs: 0, opex: 0, headcount: 0 },
            ],
            months: ["2026-01"],
          },
        });
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      if (url.includes("/api/custom-variables")) {
        return json({ customVariables: builtinVars() });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await chooseSelectOption(/year/i, "2025");
    await chooseSelectOption(/forecast department/i, "GPU Cloud");

    const revenueGrowth = (await screen.findByLabelText(
      "Revenue Growth Rate 2025-02",
    )) as HTMLInputElement;
    expect(revenueGrowth.value).toBe("20.00%");
    expect(revenueGrowth.disabled).toBe(true);
    expect(
      ((await screen.findByLabelText("COGS % of Revenue 2025-02")) as HTMLInputElement).value,
    ).toBe("50.00%");
    expect(
      ((await screen.findByLabelText("Headcount Growth Rate 2025-02")) as HTMLInputElement).value,
    ).toBe("50.00%");
    expect(
      ((await screen.findByLabelText("Cost per Head 2025-02")) as HTMLInputElement).value,
    ).toBe("20");
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
                varGlobal: {
                  revenueGrowthRate: 0.03,
                  cogsPctOfRevenue: 0.44,
                  headcountGrowthRate: 0.01,
                  costPerHead: 19000,
                },
                varMonthly: {},
                varOverrides: {},
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
      if (url.includes("/api/custom-variables")) {
        return json({ customVariables: builtinVars() });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /forecast model/i }));

    fireEvent.paste(await screen.findByLabelText("Revenue Growth Rate 2026-01"), {
      clipboardData: {
        getData: () => "10%,11%\n45%,46%",
      },
    });
    fireEvent.paste(await screen.findByLabelText("Headcount Growth Rate 2026-01"), {
      clipboardData: {
        getData: () => "0.02\t0.03\n20000\t21000",
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
        const override = body.varOverrides["Total Company"]?.monthly;
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
      if (url.endsWith("/api/dimensions")) {
        return json({
          department: [
            {
              name: "Product",
              parentName: null,
              referenceCount: 0,
              children: [
                {
                  name: "GPU Cloud",
                  parentName: "Product",
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
        return json({
          scenarios: [
            {
              id: "base",
              name: "Base Case",
              assumptions: {
                name: "Base Case",
                varGlobal: {
                  revenueGrowthRate: 0.03,
                  cogsPctOfRevenue: 0.44,
                  headcountGrowthRate: 0.01,
                  costPerHead: 19000,
                },
                varMonthly: {
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
                varOverrides: {},
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

  it("shows YoY change on Forecast Model metric cards", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/auth/me")) {
        return json({ user: { email: "director@planwell.local" } });
      }
      if (url.endsWith("/api/settings")) {
        return json({ forecastHorizon: 12, aiModel: null, lastActualsMonth: "2025-12" });
      }
      if (url.endsWith("/api/dimensions")) {
        return json({
          department: [{ name: "GPU Cloud", parentName: null, referenceCount: 4, children: [] }],
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
              assumptions: { name: "Base Case", varOverrides: {} },
            },
          ],
        });
      }
      if (url.includes("/api/cube/actuals")) {
        return json({
          rows: [
            { month: "2025-01", department: "GPU Cloud", account: "Revenue", value: 1000 },
            { month: "2025-01", department: "GPU Cloud", account: "COGS", value: 400 },
            { month: "2025-01", department: "GPU Cloud", account: "OpEx", value: 250 },
            { month: "2025-01", department: "GPU Cloud", account: "Headcount", value: 10 },
          ],
          summary: emptyCube().summary,
        });
      }
      if (url.includes("/api/cube/forecast")) {
        return json({
          rows: [
            { month: "2026-01", department: "GPU Cloud", account: "Revenue", value: 1200 },
            { month: "2026-01", department: "GPU Cloud", account: "COGS", value: 480 },
            { month: "2026-01", department: "GPU Cloud", account: "OpEx", value: 360 },
            { month: "2026-01", department: "GPU Cloud", account: "Headcount", value: 12 },
          ],
          summary: emptyCube().summary,
        });
      }
      if (url.includes("/api/cube/variance")) {
        return json({ rows: [] });
      }
      if (url.includes("/api/custom-variables")) {
        return json({ customVariables: builtinVars() });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await chooseSelectOption(/year/i, "2026");

    const kpiCard = (label: string) =>
      screen
        .getAllByText(label)
        .find((item) => item.closest('[data-slot="card"]'))
        ?.closest('[data-slot="card"]');
    expect(kpiCard("Revenue")?.textContent).toContain("+20% YoY");
    expect(kpiCard("Gross margin")?.textContent).toContain("+20% YoY");
    expect(kpiCard("OpEx ratio")?.textContent).toContain("+5 pts YoY");
    expect(kpiCard("Headcount")?.textContent).toContain("+20% YoY");
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
                varGlobal: {
                  revenueGrowthRate: 0.03,
                  cogsPctOfRevenue: 0.44,
                  headcountGrowthRate: 0.01,
                  costPerHead: 19000,
                },
                varMonthly: {},
                varOverrides: {},
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
              assumptions: {
                name: "Base Case",
                varGlobal: baseDrivers(),
                varMonthly: {},
                varOverrides: {},
              },
            },
            {
              id: "upside",
              name: "Aggressive Growth",
              assumptions: {
                name: "Aggressive Growth",
                varGlobal: baseDrivers(),
                varMonthly: {},
                varOverrides: {},
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
          rows: [],
          summary: {
            ...emptyCube().summary,
            kpis: {
              revenue: 1000,
              grossMargin: 600,
              grossMarginPct: 0.6,
              opex: 500,
              opexRatio: 0.5,
              headcount: 12,
            },
          },
        });
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
    await userEvent.click(await screen.findByRole("button", { name: /scenario comparison/i }));

    expect(await screen.findByText("Compare scenarios")).toBeTruthy();
    expect(screen.getByText("Variance analysis")).toBeTruthy();
    const kpiCard = (label: string) =>
      screen
        .getAllByText(label)
        .find((item) => item.closest('[data-slot="card"]'))
        ?.closest('[data-slot="card"]');
    await waitFor(() => {
      expect(kpiCard("Revenue variance")?.textContent).toContain("$200");
    });
    expect(kpiCard("Revenue variance")?.textContent).not.toContain("$1,000");
    expect(kpiCard("Gross margin variance")?.textContent).toContain("$200");
    expect(kpiCard("OpEx variance")?.textContent).toContain("$150");
    expect(kpiCard("Headcount variance")?.textContent).toContain("0");
    expect(screen.queryByText("OpEx ratio")).toBeNull();
    expect(screen.getAllByRole("button", { name: /copy grid/i })).toHaveLength(1);
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
      if (url.endsWith("/api/dimensions")) {
        return json({
          department: [
            {
              name: "Product",
              parentName: null,
              referenceCount: 0,
              children: [
                {
                  name: "GPU Cloud",
                  parentName: "Product",
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
        return json({
          scenarios: [
            {
              id: "base",
              name: "Base Case",
              assumptions: {
                name: "Base Case",
                varGlobal: {
                  revenueGrowthRate: 0.03,
                  cogsPctOfRevenue: 0.44,
                  headcountGrowthRate: 0.01,
                  costPerHead: 19000,
                },
                varMonthly: {},
                varOverrides: {},
              },
            },
            {
              id: "upside",
              name: "Aggressive Growth",
              assumptions: {
                name: "Aggressive Growth",
                varGlobal: {
                  revenueGrowthRate: 0.05,
                  cogsPctOfRevenue: 0.42,
                  headcountGrowthRate: 0.02,
                  costPerHead: 19500,
                },
                varMonthly: {},
                varOverrides: {},
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

    await userEvent.click(await screen.findByRole("button", { name: "Forecast Model" }));
    await screen.findByText("Driver assumptions");
    expect(document.querySelectorAll(".topbar .page-selector-label")).toHaveLength(0);
    expect(screen.getByLabelText("Forecast department")).toBeTruthy();
    expect(screen.getByLabelText("Primary scenario")).toBeTruthy();
    expect(screen.queryByText("Compare to")).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /forecast department/i }).textContent).toContain(
        "Product",
      ),
    );
    await userEvent.click(screen.getByRole("combobox", { name: /forecast department/i }));
    expect(screen.queryByRole("option", { name: /all departments/i })).toBeNull();
    expect(screen.getByRole("option", { name: "Product" }).getAttribute("data-depth")).toBe("0");
    expect(screen.getByRole("option", { name: "GPU Cloud" }).getAttribute("data-depth")).toBe("1");
    expect(
      screen
        .getByRole("option", { name: "GPU Cloud" })
        .style.getPropertyValue("--select-option-padding-left"),
    ).toBe("24px");

    await userEvent.click(screen.getByRole("button", { name: /scenario comparison/i }));
    expect(await screen.findByText("Compare to")).toBeTruthy();
    const labels = Array.from(document.querySelectorAll(".topbar .page-selector-label")).map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(["Primary scenario", "Compare to"]);
    expect(document.querySelectorAll(".topbar .inline-selector")).toHaveLength(2);
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
              assumptions: {
                name: "Base Case",
                varGlobal: baseDrivers(),
                varMonthly: {},
                varOverrides: {},
              },
            },
            {
              id: "upside",
              name: "Aggressive Growth",
              assumptions: {
                name: "Aggressive Growth",
                varGlobal: baseDrivers(),
                varMonthly: {},
                varOverrides: {},
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
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

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

    expect(document.querySelector(".schema-summary")).toBeNull();
    expect(await screen.findByRole("tab", { name: "Departments" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Accounts" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Time" })).toBeNull();
    expect(document.querySelector(".dimension-tabs")).toBeTruthy();
    expect(document.querySelector(".folder-tabs")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Departments" }).className).toContain("dimension-tab");
    expect(screen.getByRole("tab", { name: "Departments" }).className).toContain("active");

    await openAdminPage(/^time settings$/i);
    expect(screen.getByRole("heading", { name: "Time Settings", level: 1 })).toBeTruthy();
    expect(document.querySelector(".schema-summary")).toBeNull();
    expect(screen.getByRole("heading", { name: "Time members", level: 2 })).toBeTruthy();
    await openAdminPage(/^dimensions$/i);

    const gpuCloudLabel = await screen.findByText("GPU Cloud");
    fireEvent.doubleClick(gpuCloudLabel);

    const nameInput = screen.getByLabelText("Name for GPU Cloud");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Cloud AI{enter}");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dimensions/department/members/GPU%20Cloud",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Cloud AI", parentName: "Product" }),
      }),
    );
    const deleteBtn = await screen.findByRole("button", { name: "Delete Cloud AI" });
    await userEvent.click(deleteBtn);
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
    const moveUpBtn = await screen.findByRole("button", { name: "Move GPU Cloud up" });
    await userEvent.click(moveUpBtn);

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
    const orderStatuses = await screen.findAllByText("Order updated.");
    expect(
      orderStatuses.some((status) =>
        status.closest("section")?.textContent?.includes("Department members"),
      ),
    ).toBe(true);
    const treeNodes = screen
      .getAllByRole("row")
      .map((row) => row.querySelector("td")?.textContent?.trim())
      .filter(Boolean);
    expect(treeNodes).toEqual(["Product", "GPU Cloud", "Inference Platform"]);
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
    const moveDownBtn = await screen.findByRole("button", { name: "Move Inference Platform down" });
    await userEvent.click(moveDownBtn);

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
      .getAllByRole("row")
      .map((row) => row.querySelector("td")?.textContent?.trim())
      .filter(Boolean);
    expect(optimisticTreeNodes).toEqual(["Product", "GPU Cloud", "Inference Platform"]);

    resolvePatch?.(json({ dimensions: reorderedDimensions }));
    expect(await screen.findAllByText("Order updated.")).toBeTruthy();
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

    // Test inline editing double click
    const engineeringLabel = screen.getByText("Engineering");
    fireEvent.doubleClick(engineeringLabel);
    const input = screen.getByLabelText("Name for Engineering");
    expect(input).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" }); // Exit edit mode

    // Test moving members using up/down buttons
    const moveDownButton = screen.getByRole("button", { name: "Move Engineering down" });
    fireEvent.click(moveDownButton);

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

    // Check that tree nodes exist
    const treeNodes = screen
      .getAllByRole("row")
      .map((row) => row.querySelector("td")?.textContent?.trim())
      .filter(Boolean);
    expect(treeNodes).toEqual(["Product", "G&A", "Engineering"]);
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
    expect(document.querySelector(".schema-summary")).toBeNull();
    expect(screen.getByText("time_month")).toBeTruthy();
    expect(screen.getAllByText("actuals").length).toBeGreaterThan(0);
    expect(screen.getAllByText("forecast_values").length).toBeGreaterThan(0);
    expect(screen.getAllByText("versions").length).toBeGreaterThan(0);
    expect(screen.getAllByText("kind").length).toBeGreaterThan(0);
    expect(screen.getByText("actuals or scenario")).toBeTruthy();
    expect(
      screen
        .queryAllByText("scenarios")
        .filter((element) => element.tagName.toLowerCase() === "header"),
    ).toHaveLength(1);
    expect(screen.queryByText("assumptions_json")).toBeNull();
    expect(screen.queryByText("driver_assumptions")).toBeNull();
    expect(screen.queryByText("scope_type")).toBeNull();
    expect(screen.getAllByText("parent_name").length).toBeGreaterThan(0);
    expect(screen.getAllByText("sort_order").length).toBeGreaterThan(0);
    expect(screen.getByText("Derived time hierarchy")).toBeTruthy();
    expect(screen.getAllByText("Versions").length).toBeGreaterThan(0);
    expect(screen.getByText("Scenarios are versions with kind = scenario")).toBeTruthy();
    expect(screen.getByText("Locked scenario versions are read-only")).toBeTruthy();
    expect(screen.getByText("Everything other than Actuals is a scenario version")).toBeTruthy();
    const versionsTable = screen
      .getAllByText("versions")
      .find((element) => element.tagName.toLowerCase() === "header");
    expect(versionsTable?.closest(".erd-lane")?.querySelector(".lane-label")?.textContent).toBe(
      "Dimensions",
    );
    expect(screen.getAllByText("scenario_id -> versions.id").length).toBeGreaterThan(0);
    expect(screen.getByText("custom_variables")).toBeTruthy();
    expect(screen.getByText("custom_variable_values")).toBeTruthy();
    expect(screen.getByText("var_id -> custom_variables.id")).toBeTruthy();
    expect(screen.getByText("input or calculated")).toBeTruthy();
    expect(screen.getByLabelText("ERD relationship lines")).toBeTruthy();
  });

  it("manages versions under Admin while protecting Actuals", async () => {
    let versions = [
      {
        id: "actuals",
        name: "Actuals",
        kind: "actuals",
        locked: false,
        canLock: false,
        canRename: false,
        canDelete: false,
      },
      {
        id: "base",
        name: "Base Case",
        kind: "scenario",
        locked: false,
        canLock: true,
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
            locked: false,
            canLock: true,
            canRename: true,
            canDelete: true,
          };
          return json({ version, versions: [...versions, version] }, 201);
        }
        return json({ versions });
      }
      if (url.endsWith("/api/versions/board") && init?.method === "PATCH") {
        const body = JSON.parse(init.body as string) as { name?: string; locked?: boolean };
        const currentBoard = versions.find((version) => version.id === "board");
        const nextVersion = {
          id: "board",
          name: body.name ?? currentBoard?.name ?? "Board Case",
          kind: "scenario",
          locked: body.locked ?? currentBoard?.locked ?? false,
          canLock: true,
          canRename: true,
          canDelete: true,
        };
        versions = [...versions.filter((version) => version.id !== "board"), nextVersion];
        return json({ version: nextVersion, versions });
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
    expect(document.querySelector(".schema-summary")).toBeNull();
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
    expect(screen.getAllByText("Board Case").length).toBeGreaterThan(0);

    const lockBoard = await screen.findByRole("checkbox", { name: /lock Board Case/i });
    await userEvent.click(lockBoard);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/versions/board",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ locked: true }),
      }),
    );

    await userEvent.dblClick(screen.getAllByText("Board Case")[0]!);
    await userEvent.clear(await screen.findByLabelText("Name for Board Case"));
    await userEvent.type(screen.getByLabelText("Name for Board Case"), "Operating Plan");
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
    expect(screen.queryByLabelText("Name for Operating Plan")).toBeNull();
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

async function getSelectOptions(label: string | RegExp): Promise<
  {
    depth: string | null;
    label: string;
    paddingLeft: string;
    value: string;
  }[]
> {
  const trigger = await screen.findByRole("combobox", { name: label });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    await userEvent.click(trigger);
  }
  const options = await screen.findAllByRole("option");
  const values = options.map((option) => ({
    depth: option.getAttribute("data-depth"),
    label: option.textContent?.trim() ?? "",
    paddingLeft: option.style.getPropertyValue("--select-option-padding-left"),
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

function builtinVars() {
  return [
    { id: "revenueGrowthRate", label: "Revenue Growth Rate", kind: "input" },
    { id: "cogsPctOfRevenue", label: "COGS % of Revenue", kind: "input" },
    { id: "headcountGrowthRate", label: "Headcount Growth Rate", kind: "input" },
    { id: "costPerHead", label: "Cost per Head", kind: "input" },
  ];
}
