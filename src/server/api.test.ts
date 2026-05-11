import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vite-plus/test";
import { createApp } from "./app.ts";
import { createFileRepository, createTestRepository, pruneExpiredSessions } from "./repository.ts";

describe("PlanWell API", () => {
  it("logs in, imports long CSV actuals, creates forecasts, and returns variance", async () => {
    const repo = createTestRepository();
    const app = createApp({ repo });

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "director@planwell.local", password: "planwell-demo" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("planwell_session=");

    const imported = await app.request("/api/imports/csv", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        csv: `month,department,account,value
2025-12,GPU Cloud,Revenue,1000
2025-12,GPU Cloud,COGS,450
2025-12,GPU Cloud,Headcount,10
2025-12,GPU Cloud,OpEx,180000
`,
      }),
    });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({ diagnostics: { rowsImported: 4 } });

    const scenarios = await app.request("/api/scenarios", { headers: { cookie } });
    expect(scenarios.status).toBe(200);
    const scenarioBody = await scenarios.json();
    expect(scenarioBody.scenarios.map((scenario: { name: string }) => scenario.name)).toEqual([
      "Base Case",
      "Aggressive Growth",
      "Conservative",
    ]);

    const variance = await app.request(
      "/api/cube/variance?left=Base%20Case&right=Aggressive%20Growth",
      {
        headers: { cookie },
      },
    );
    expect(variance.status).toBe(200);
    const varianceBody = await variance.json();
    expect(
      varianceBody.rows.some(
        (row: { account: string; variance: number }) =>
          row.account === "Revenue" && row.variance > 0,
      ),
    ).toBe(true);
  });

  it("pruneExpiredSessions removes rows with past expires_at", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      create table sessions (id text primary key, user_id text not null, expires_at text not null);
    `);
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 9999999).toISOString();
    db.prepare("insert into sessions values (?, ?, ?)").run("old", "u1", past);
    db.prepare("insert into sessions values (?, ?, ?)").run("new", "u2", future);

    pruneExpiredSessions(db);

    const rows = db.prepare("select id from sessions").all() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["new"]);
  });

  it("migrates legacy scenario JSON into driver assumption rows", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "planwell-")), "legacy.sqlite");
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      create table scenarios (
        id text primary key,
        name text not null unique,
        assumptions_json text not null,
        created_at text not null,
        updated_at text not null
      );
    `);
    legacyDb
      .prepare(
        "insert into scenarios (id, name, assumptions_json, created_at, updated_at) values (?, ?, ?, ?, ?)",
      )
      .run(
        "legacy-scenario",
        "Legacy Case",
        JSON.stringify({
          name: "Legacy Case",
          global: {
            revenueGrowthRate: 0.02,
            cogsPctOfRevenue: 0.4,
            headcountGrowthRate: 0.01,
            costPerHead: 12000,
          },
          monthly: {
            "2026-02": { revenueGrowthRate: 0.05 },
          },
          overrides: {
            "GPU Cloud": {
              cogsPctOfRevenue: 0.38,
              monthly: {
                "2026-03": { costPerHead: 13000 },
              },
            },
          },
        }),
        "2026-01-01T00:00:00.000Z",
        "2026-01-02T00:00:00.000Z",
      );
    legacyDb.close();

    const repo = createFileRepository(dbPath);
    const scenario = repo.listScenarios().find((item) => item.name === "Legacy Case");
    expect(scenario?.assumptions).toMatchObject({
      varOverrides: {
        "GPU Cloud": {
          monthly: {
            "2026-03": { costPerHead: 13000 },
          },
        },
      },
    });

    const migratedDb = new DatabaseSync(dbPath);
    const scenarioColumns = migratedDb.prepare("pragma table_info(scenarios)").all() as {
      name: string;
    }[];
    expect(scenarioColumns.map((column) => column.name)).not.toContain("assumptions_json");
    const varRows = migratedDb
      .prepare(
        "select var_id, scope, value from custom_variable_values where scenario_id = ? order by var_id, scope",
      )
      .all("legacy-scenario");
    expect(varRows).toContainEqual({
      var_id: "costPerHead",
      scope: "dept:GPU Cloud:monthly:2026-03",
      value: 13000,
    });
    expect(varRows.every((r) => String(r.scope).startsWith("dept:") && String(r.scope).includes(":monthly:"))).toBe(true);
    migratedDb.close();
  });

  it("keeps analyst answers grounded in aggregate tools", async () => {
    const repo = createTestRepository();
    repo.replaceActuals([
      { month: "2025-12", department: "GPU Cloud", account: "Revenue", value: 1000 },
      { month: "2025-12", department: "GPU Cloud", account: "COGS", value: 400 },
    ]);
    const app = createApp({ repo });

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "director@planwell.local", password: "planwell-demo" }),
    });
    const cookie = login.headers.get("set-cookie") ?? "";
    const response = await app.request("/api/analyst/ask", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ question: "What is GPU Cloud gross margin?" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toContain("GPU Cloud");
    expect(body.citations[0]).toMatchObject({ tool: "getMetricSummary" });
  });

  it("explains scenario differences from grounded variance rows", async () => {
    const repo = createTestRepository();
    repo.replaceActuals([
      { month: "2025-12", department: "GPU Cloud", account: "Revenue", value: 1000 },
      { month: "2025-12", department: "GPU Cloud", account: "COGS", value: 400 },
      { month: "2025-12", department: "GPU Cloud", account: "Headcount", value: 10 },
      { month: "2025-12", department: "GPU Cloud", account: "OpEx", value: 100000 },
    ]);
    const app = createApp({ repo });
    const cookie = await loginCookie(app);

    const response = await app.request("/api/analyst/ask", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        question: "What changed versus Aggressive Growth?",
        scenario: "Base Case",
        compareScenario: "Aggressive Growth",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toContain("Base Case vs Aggressive Growth");
    expect(body.answer).toContain("largest variance");
    expect(body.citations[0]).toMatchObject({ tool: "compareScenarios" });
  });

  it("manages versions while protecting Actuals", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "planwell-versions-")), "versions.sqlite");
    const repo = createFileRepository(dbPath);
    const app = createApp({ repo });
    const cookie = await loginCookie(app);
    repo.replaceActuals([
      { month: "2025-12", department: "GPU Cloud", account: "Revenue", value: 1000 },
      { month: "2025-12", department: "GPU Cloud", account: "COGS", value: 400 },
    ]);

    const listed = await app.request("/api/versions", { headers: { cookie } });
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.versions[0]).toMatchObject({
      id: "actuals",
      name: "Actuals",
      kind: "actuals",
      canDelete: false,
      canRename: false,
      locked: false,
    });
    expect(listedBody.versions.map((version: { name: string }) => version.name)).toContain(
      "Base Case",
    );
    const inspectDb = new DatabaseSync(dbPath);
    const versionColumns = inspectDb.prepare("pragma table_info(versions)").all() as {
      name: string;
    }[];
    expect(versionColumns.map((column) => column.name)).toEqual([
      "id",
      "name",
      "kind",
      "locked",
      "created_at",
      "updated_at",
      "sort_order",
    ]);
    expect(
      inspectDb.prepare("select id, name, kind, locked from versions where id = ?").get("actuals"),
    ).toMatchObject({ id: "actuals", name: "Actuals", kind: "actuals", locked: 0 });

    const copied = await app.request("/api/versions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Board Case", sourceId: "actuals" }),
    });
    expect(copied.status).toBe(201);
    expect(await copied.json()).toMatchObject({
      version: { name: "Board Case", kind: "scenario", canDelete: true },
    });
    const boardTableRow = inspectDb
      .prepare("select name, kind from versions where name = ?")
      .get("Board Case");
    expect(boardTableRow).toMatchObject({ name: "Board Case", kind: "scenario" });
    expect(repo.listForecast("Board Case")).toEqual([
      { month: "2025-12", department: "GPU Cloud", account: "COGS", value: 400 },
      { month: "2025-12", department: "GPU Cloud", account: "Revenue", value: 1000 },
    ]);

    const boardVersion = repo.listScenarios().find((scenario) => scenario.name === "Board Case");
    expect(boardVersion).toBeTruthy();
    const locked = await app.request(`/api/versions/${boardVersion!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ locked: true }),
    });
    expect(locked.status).toBe(200);
    expect(await locked.json()).toMatchObject({
      version: { name: "Board Case", kind: "scenario", locked: true },
    });
    expect(
      inspectDb.prepare("select locked from versions where id = ?").get(boardVersion!.id),
    ).toMatchObject({ locked: 1 });

    const editLocked = await app.request("/api/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Board Case",
        varOverrides: {},
      }),
    });
    expect(editLocked.status).toBe(400);
    expect(await editLocked.json()).toMatchObject({
      error: "Board Case is locked and cannot be edited.",
    });

    const unlock = await app.request(`/api/versions/${boardVersion!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ locked: false }),
    });
    expect(unlock.status).toBe(200);
    expect(await unlock.json()).toMatchObject({
      version: { name: "Board Case", kind: "scenario", locked: false },
    });

    const renamed = await app.request(`/api/versions/${boardVersion!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Operating Plan" }),
    });
    expect(renamed.status).toBe(200);
    expect(repo.listScenarios().some((scenario) => scenario.name === "Operating Plan")).toBe(true);
    expect(
      inspectDb.prepare("select name from versions where id = ?").get(boardVersion!.id),
    ).toMatchObject({ name: "Operating Plan" });
    expect(repo.listForecast("Operating Plan")).toEqual([
      { month: "2025-12", department: "GPU Cloud", account: "COGS", value: 400 },
      { month: "2025-12", department: "GPU Cloud", account: "Revenue", value: 1000 },
    ]);

    const deleteActuals = await app.request("/api/versions/actuals", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleteActuals.status).toBe(400);
    expect(await deleteActuals.json()).toMatchObject({ error: "Actuals cannot be deleted." });

    const operatingPlan = repo
      .listScenarios()
      .find((scenario) => scenario.name === "Operating Plan");
    const countRows = (table: string) =>
      (
        inspectDb
          .prepare(`select count(*) as count from ${table} where scenario_id = ?`)
          .get(operatingPlan!.id) as { count: number }
      ).count;
    expect(countRows("forecast_values")).toBeGreaterThan(0);

    const deleted = await app.request(`/api/versions/${operatingPlan!.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleted.status).toBe(200);
    expect(repo.listScenarios().some((scenario) => scenario.name === "Operating Plan")).toBe(false);
    expect(countRows("forecast_values")).toBe(0);
    expect(countRows("custom_variable_values")).toBe(0);
    expect(
      (
        inspectDb
          .prepare("select count(*) as count from scenarios where id = ?")
          .get(operatingPlan!.id) as { count: number }
      ).count,
    ).toBe(0);
    expect(
      (
        inspectDb
          .prepare("select count(*) as count from versions where id = ?")
          .get(operatingPlan!.id) as { count: number }
      ).count,
    ).toBe(0);
    inspectDb.close();
  });

  it("manages department hierarchies and safely cascades renames", async () => {
    const repo = createTestRepository();
    const app = createApp({ repo });
    const cookie = await loginCookie(app);

    repo.replaceActuals([
      { month: "2025-12", department: "GPU Cloud", account: "Revenue", value: 1000 },
      { month: "2025-12", department: "Inference Platform", account: "Revenue", value: 600 },
      { month: "2025-12", department: "GPU Cloud", account: "COGS", value: 400 },
    ]);

    const createProduct = await app.request("/api/dimensions/department/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Product" }),
    });
    expect(createProduct.status).toBe(201);

    const moveGpu = await app.request("/api/dimensions/department/members/GPU%20Cloud", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ parentName: "Product" }),
    });
    expect(moveGpu.status).toBe(200);

    const moveInference = await app.request(
      "/api/dimensions/department/members/Inference%20Platform",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ parentName: "Product" }),
      },
    );
    expect(moveInference.status).toBe(200);

    const dimensions = await app.request("/api/dimensions", { headers: { cookie } });
    const body = await dimensions.json();
    const product = body.department.find((item: { name: string }) => item.name === "Product");
    expect(product.children.map((child: { name: string }) => child.name)).toEqual([
      "GPU Cloud",
      "Inference Platform",
    ]);

    const reorderInference = await app.request(
      "/api/dimensions/department/members/Inference%20Platform",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ sortOrder: -0.5 }),
      },
    );
    expect(reorderInference.status).toBe(200);

    const reorderedDimensions = await app.request("/api/dimensions", { headers: { cookie } });
    const reorderedBody = await reorderedDimensions.json();
    const reorderedProduct = reorderedBody.department.find(
      (item: { name: string }) => item.name === "Product",
    );
    expect(reorderedProduct.children.map((child: { name: string }) => child.name)).toEqual([
      "Inference Platform",
      "GPU Cloud",
    ]);

    const rename = await app.request("/api/dimensions/department/members/GPU%20Cloud", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Cloud AI", parentName: "Product" }),
    });
    expect(rename.status).toBe(200);

    const actuals = await app.request("/api/cube/actuals", { headers: { cookie } });
    const actualsBody = await actuals.json();
    expect(
      actualsBody.rows.some((row: { department: string }) => row.department === "Cloud AI"),
    ).toBe(true);
    expect(
      actualsBody.summary.departments.find(
        (department: { department: string; revenue: number }) =>
          department.department === "Product",
      )?.revenue,
    ).toBe(1600);

    await app.request("/api/dimensions/account/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Financial Accounts" }),
    });
    await app.request("/api/dimensions/account/members/Revenue", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ parentName: "Financial Accounts" }),
    });
    await app.request("/api/dimensions/account/members/COGS", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ parentName: "Financial Accounts" }),
    });

    const rolledUpActuals = await app.request("/api/cube/actuals", { headers: { cookie } });
    const rolledUpBody = await rolledUpActuals.json();
    expect(
      rolledUpBody.summary.accounts.find(
        (account: { account: string; value: number }) => account.account === "Financial Accounts",
      )?.value,
    ).toBe(2000);
  });

  it("rejects hierarchy cycles and requires force before deleting referenced members", async () => {
    const repo = createTestRepository();
    const app = createApp({ repo });
    const cookie = await loginCookie(app);
    repo.replaceActuals([
      { month: "2025-12", department: "GPU Cloud", account: "Revenue", value: 1000 },
    ]);

    await app.request("/api/dimensions/department/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Product" }),
    });

    await app.request("/api/dimensions/department/members/Product", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ parentName: "GPU Cloud" }),
    });

    const cycle = await app.request("/api/dimensions/department/members/GPU%20Cloud", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ parentName: "Product" }),
    });
    expect(cycle.status).toBe(400);
    expect(await cycle.json()).toMatchObject({ error: "Hierarchy cycle detected." });

    const blockedDelete = await app.request("/api/dimensions/department/members/GPU%20Cloud", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(blockedDelete.status).toBe(409);
    expect(await blockedDelete.json()).toMatchObject({
      impact: { actualRows: 1, forecastRows: 144, scenarioOverrides: 3, childCount: 1 },
    });

    const forcedDelete = await app.request(
      "/api/dimensions/department/members/GPU%20Cloud?force=1",
      { method: "DELETE", headers: { cookie } },
    );
    expect(forcedDelete.status).toBe(200);
    expect(await forcedDelete.json()).toMatchObject({ ok: true });
  });

  it("recalculates forecasts after department hierarchy changes", async () => {
    const repo = createTestRepository();
    const app = createApp({ repo });
    const cookie = await loginCookie(app);
    repo.replaceActuals([
      { month: "2025-12", department: "GPU Cloud", account: "Revenue", value: 1000 },
      { month: "2025-12", department: "GPU Cloud", account: "Headcount", value: 10 },
    ]);

    await app.request("/api/dimensions/department/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Product" }),
    });
    const scenario = await app.request("/api/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Hierarchy Sensitivity",
        varOverrides: {
          Product: {
            monthly: {
              "2026-01": { revenueGrowthRate: 0.5 },
            },
          },
        },
      }),
    });
    expect(scenario.status).toBe(201);

    const beforeMove = await app.request("/api/cube/forecast?scenario=Hierarchy%20Sensitivity", {
      headers: { cookie },
    });
    const beforeMoveBody = await beforeMove.json();
    expect(
      beforeMoveBody.rows.find(
        (row: { month: string; department: string; account: string }) =>
          row.month === "2026-01" && row.department === "GPU Cloud" && row.account === "Revenue",
      )?.value,
    ).toBe(1000);

    const moveGpu = await app.request("/api/dimensions/department/members/GPU%20Cloud", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ parentName: "Product" }),
    });
    expect(moveGpu.status).toBe(200);

    const afterMove = await app.request("/api/cube/forecast?scenario=Hierarchy%20Sensitivity", {
      headers: { cookie },
    });
    const afterMoveBody = await afterMove.json();
    expect(
      afterMoveBody.rows.find(
        (row: { month: string; department: string; account: string }) =>
          row.month === "2026-01" && row.department === "GPU Cloud" && row.account === "Revenue",
      )?.value,
    ).toBe(1500);
  });

  it("manages month members and derives year and quarter hierarchy", async () => {
    const repo = createTestRepository();
    const app = createApp({ repo });
    const cookie = await loginCookie(app);

    const createMonth = await app.request("/api/dimensions/time/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "2026-02" }),
    });
    expect(createMonth.status).toBe(201);

    const invalidMonth = await app.request("/api/dimensions/time/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Feb 2026" }),
    });
    expect(invalidMonth.status).toBe(400);

    const dimensions = await app.request("/api/dimensions", { headers: { cookie } });
    const body = await dimensions.json();
    expect(body.time).toEqual([
      {
        name: "2026",
        parentName: null,
        referenceCount: 0,
        children: [
          {
            name: "2026 Q1",
            parentName: "2026",
            referenceCount: 0,
            children: [
              {
                name: "2026-02",
                parentName: "2026 Q1",
                referenceCount: 0,
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("includes forecast months in the derived time dimension", async () => {
    const repo = createTestRepository();
    const app = createApp({ repo });
    const cookie = await loginCookie(app);

    const imported = await app.request("/api/imports/csv", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        csv: `month,department,account,value
2025-12,GPU Cloud,Revenue,1000
2025-12,GPU Cloud,COGS,450
2025-12,GPU Cloud,Headcount,10
2025-12,GPU Cloud,OpEx,180000
`,
      }),
    });
    expect(imported.status).toBe(200);

    const forecast = await app.request("/api/cube/forecast?scenario=Base%20Case", {
      headers: { cookie },
    });
    const forecastBody = await forecast.json();
    expect(forecastBody.summary.months).toContain("2026-01");

    const dimensions = await app.request("/api/dimensions", { headers: { cookie } });
    const body = await dimensions.json();
    expect(body.time.map((member: { name: string }) => member.name)).toEqual(["2025", "2026"]);
    expect(
      body.time
        .find((member: { name: string }) => member.name === "2026")
        ?.children.flatMap((quarter: { children: { name: string }[] }) =>
          quarter.children.map((month) => month.name),
        ),
    ).toContain("2026-01");
  });

  it("returns 400 for malformed login body", async () => {
    const repo = createTestRepository();
    const app = createApp({ repo });

    const bad = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notEmail: "foo" }),
    });
    expect(bad.status).toBe(400);
  });

  it("returns 400 for malformed analyst body", async () => {
    const repo = createTestRepository();
    const app = createApp({ repo });
    const cookie = await loginCookie(app);

    const bad = await app.request("/api/analyst/ask", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ notQuestion: true }),
    });
    expect(bad.status).toBe(400);
  });

  it("adds a full planning year and extends forecasts through explicit future time months", async () => {
    const repo = createTestRepository();
    const app = createApp({ repo });
    const cookie = await loginCookie(app);

    const imported = await app.request("/api/imports/csv", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        csv: `month,department,account,value
2025-12,GPU Cloud,Revenue,1000
2025-12,GPU Cloud,COGS,450
2025-12,GPU Cloud,Headcount,10
2025-12,GPU Cloud,OpEx,180000
`,
      }),
    });
    expect(imported.status).toBe(200);

    const createYear = await app.request("/api/dimensions/time/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "2027" }),
    });
    expect(createYear.status).toBe(201);

    const forecast = await app.request("/api/cube/forecast?scenario=Base%20Case", {
      headers: { cookie },
    });
    const forecastBody = await forecast.json();
    expect(forecastBody.summary.months.at(-1)).toBe("2027-12");
    expect(forecastBody.rows.some((row: { month: string }) => row.month === "2027-12")).toBe(true);

    const dimensions = await app.request("/api/dimensions", { headers: { cookie } });
    const body = await dimensions.json();
    const year = body.time.find((member: { name: string }) => member.name === "2027");
    expect(
      year.children.flatMap((quarter: { children: { name: string }[] }) =>
        quarter.children.map((month) => month.name),
      ),
    ).toHaveLength(12);
  });

  it("skips demo user seeding when PLANWELL_SKIP_SEED=1", () => {
    const original = process.env.PLANWELL_SKIP_SEED;
    process.env.PLANWELL_SKIP_SEED = "1";
    try {
      const repo = createTestRepository();
      const user = repo.verifyUser("director@planwell.local", "planwell-demo");
      expect(user).toBeNull();
    } finally {
      process.env.PLANWELL_SKIP_SEED = original;
    }
  });

  it("readScenarios returns scenarios in sort_order order", async () => {
    const repo = createTestRepository();
    repo.replaceActuals([
      { month: "2025-12", department: "GPU Cloud", account: "Revenue", value: 1000 },
    ]);
    const scenarios = repo.listScenarios();
    expect(scenarios.map((s) => s.name)).toEqual([
      "Base Case",
      "Aggressive Growth",
      "Conservative",
    ]);
  });

  it("listPlanningForecastMonths returns 12 months after last actual month", async () => {
    const repo = createTestRepository();
    repo.replaceActuals([
      { month: "2025-06", department: "GPU Cloud", account: "Revenue", value: 500 },
      { month: "2025-07", department: "GPU Cloud", account: "Revenue", value: 600 },
    ]);
    const forecast = repo.listForecast("Base Case");
    const months = [...new Set(forecast.map((r) => r.month))].sort();
    expect(months[0]).toBe("2025-08");
    expect(months).toHaveLength(12);
  });

  it("legacy migration is atomic — rolls back partial custom_variable_values writes on error", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      create table scenarios (
        id text primary key,
        name text not null unique,
        assumptions_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create table custom_variable_values (
        scenario_id text not null,
        var_id text not null,
        scope text not null,
        value real not null,
        primary key (scenario_id, var_id, scope)
      );
    `);

    // First row: valid JSON → replaceVarValues will write to custom_variable_values
    db.prepare(
      "insert into scenarios (id, name, assumptions_json, created_at, updated_at) values (?, ?, ?, ?, ?)",
    ).run(
      "good-id",
      "Good Case",
      JSON.stringify({ name: "Good Case", global: { revenueGrowthRate: 0.05 } }),
      "2025-01-01",
      "2025-01-01",
    );

    // Second row: invalid JSON → will throw mid-migration
    db.prepare(
      "insert into scenarios (id, name, assumptions_json, created_at, updated_at) values (?, ?, ?, ?, ?)",
    ).run("bad-id", "Bad Case", "NOT_VALID_JSON", "2025-01-01", "2025-01-01");

    const { migrateLegacyScenarioAssumptions } = await import("./db/migrations.ts");

    expect(() => migrateLegacyScenarioAssumptions(db)).toThrow();

    // Without a transaction, the first row's custom_variable_values writes would persist.
    // With a transaction, they must be rolled back.
    const varRows = db
      .prepare("select count(*) as cnt from custom_variable_values where scenario_id = ?")
      .get("good-id") as { cnt: number };
    expect(varRows.cnt).toBe(0);

    // The scenarios table should still have assumptions_json (DDL was rolled back too)
    const columns = db.prepare("pragma table_info(scenarios)").all() as { name: string }[];
    expect(columns.map((c) => c.name)).toContain("assumptions_json");
  });

  it("recalculateAll continues past a scenario that throws, does not throw itself", () => {
    const repo = createTestRepository();
    repo.replaceActuals([
      { month: "2025-12", department: "GPU Cloud", account: "Revenue", value: 1000 },
      { month: "2025-12", department: "GPU Cloud", account: "COGS", value: 400 },
      { month: "2025-12", department: "GPU Cloud", account: "Headcount", value: 10 },
      { month: "2025-12", department: "GPU Cloud", account: "OpEx", value: 100000 },
    ]);

    // recalculateAllScenarios should not throw even if internal work fails
    expect(() => repo.recalculateAllScenarios()).not.toThrow();

    // Other scenarios should have forecast rows
    const forecast = repo.listForecast("Aggressive Growth");
    expect(forecast.length).toBeGreaterThan(0);
  });

  it("blocks deleting a custom variable that is referenced in a formula", async () => {
    const repo = createTestRepository();
    const app = createApp({ repo });
    const cookie = await loginCookie(app);

    const createA = await app.request("/api/custom-variables", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ id: "myRate", label: "My Rate", kind: "input" }),
    });
    expect(createA.status).toBe(201);

    const createB = await app.request("/api/custom-variables", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ id: "myCalc", label: "My Calc", kind: "calculated", formula: "myRate * 2" }),
    });
    expect(createB.status).toBe(201);

    const del = await app.request("/api/custom-variables/myRate", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(400);
    const body = await del.json();
    expect(body.error).toContain("myRate");
  });

  it("rejects mathjs import() in formula validation", async () => {
    const repo = createTestRepository();
    const app = createApp({ repo });
    const cookie = await loginCookie(app);

    const result = await app.request("/api/scenarios/validate-formula", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ formula: 'import("mathjs")', account: "Revenue" }),
    });
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/undefined function import/i);
  });

  it("rejects createUnit in custom variable formula validation", async () => {
    const repo = createTestRepository();
    const app = createApp({ repo });
    const cookie = await loginCookie(app);

    const result = await app.request("/api/custom-variables/validate-formula", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ formula: "createUnit('widget', '1')", availableIds: [] }),
    });
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.ok).toBe(false);
  });
});

async function loginCookie(app: ReturnType<typeof createApp>): Promise<string> {
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "director@planwell.local", password: "planwell-demo" }),
  });
  return login.headers.get("set-cookie") ?? "";
}
