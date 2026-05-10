import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { parseActualsCsv } from "../domain/importer.ts";
import { coreAccounts, type ScenarioAssumptions } from "../domain/types.ts";
import { createAnalyst } from "./analyst.ts";
import { DimensionReferenceError, type Repository } from "./repository.ts";
import { sampleLongCsv, sampleWideCsv } from "./sample-data.ts";

type AppEnv = {
  Variables: {
    user: { userId: string; email: string };
  };
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const csvImportSchema = z.object({
  csv: z.string().min(1),
});

const coreAccountEnum = z.enum(coreAccounts);

const varValuesSchema = z.record(z.string(), z.number());
const partialVarValuesSchema = z.record(z.string(), z.number().optional());

const scenarioSchema: z.ZodType<ScenarioAssumptions> = z.object({
  name: z.string().min(1),
  varGlobal: varValuesSchema.optional(),
  varMonthly: z.record(z.string(), partialVarValuesSchema).optional(),
  varOverrides: z
    .record(
      z.string(),
      z.object({
        global: partialVarValuesSchema.optional(),
        monthly: z.record(z.string(), partialVarValuesSchema).optional(),
      }),
    )
    .optional(),
  formulas: z.record(z.string(), z.string().min(1)).optional(),
});

const customVarCreateSchema = z.object({
  id: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Must be a valid identifier"),
  label: z.string().min(1),
  kind: z.enum(["input", "calculated"]),
  formula: z.string().optional(),
  defaultValue: z.number().optional(),
});

const customVarUpdateSchema = z.object({
  label: z.string().min(1).optional(),
  formula: z.string().optional(),
  sortOrder: z.number().optional(),
});

const customVarValidateSchema = z.object({
  formula: z.string().min(1),
  availableIds: z.array(z.string()),
});

const formulaValidateSchema = z.object({
  formula: z.string().min(1),
  account: coreAccountEnum,
});

const analystSchema = z.object({
  question: z.string().min(1),
  scenario: z.string().optional(),
  compareScenario: z.string().optional(),
});

const dimensionKindSchema = z.enum(["department", "account", "time"]);

const dimensionMemberSchema = z.object({
  name: z.string().min(1),
  parentName: z.string().nullable().optional(),
});

const dimensionMemberUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  parentName: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
});

const versionCreateSchema = z.object({
  name: z.string().min(1),
  sourceId: z.string().min(1),
});

const versionUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    locked: z.boolean().optional(),
    sortOrder: z.number().optional(),
  })
  .refine(
    (payload) =>
      payload.name !== undefined || payload.locked !== undefined || payload.sortOrder !== undefined,
    {
      message: "Provide a version name, locked setting, or sort order.",
    },
  );

export function createApp({ repo }: { repo: Repository }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const analyst = createAnalyst(repo);

  app.get("/api/health", (context) => context.json({ ok: true }));

  app.post("/api/auth/login", async (context) => {
    let payload: { email: string; password: string };
    try {
      payload = loginSchema.parse(await context.req.json());
    } catch {
      return context.json({ error: "Invalid request." }, 400);
    }
    const user = repo.verifyUser(payload.email, payload.password);
    if (!user) {
      return context.json({ error: "Invalid email or password." }, 401);
    }
    const sessionId = repo.createSession(user.id);
    setCookie(context, "planwell_session", sessionId, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return context.json({ user });
  });

  app.get("/api/sample-csvs/:shape", (context) => {
    const shape = context.req.param("shape");
    const csv = shape === "wide" ? sampleWideCsv : sampleLongCsv;
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="planwell-${shape === "wide" ? "wide" : "long"}-sample.csv"`,
      },
    });
  });

  app.use("/api/*", async (context, next) => {
    if (
      context.req.path === "/api/auth/login" ||
      context.req.path.startsWith("/api/sample-csvs/")
    ) {
      return next();
    }
    const sessionId = getCookie(context, "planwell_session");
    const session = sessionId ? repo.getSession(sessionId) : null;
    if (!session) {
      return context.json({ error: "Authentication required." }, 401);
    }
    context.set("user", session);
    return next();
  });

  app.post("/api/auth/logout", (context) => {
    const sessionId = getCookie(context, "planwell_session");
    if (sessionId) {
      repo.deleteSession(sessionId);
    }
    deleteCookie(context, "planwell_session", { path: "/" });
    return context.json({ ok: true });
  });

  app.get("/api/auth/me", (context) => context.json({ user: context.get("user") }));

  app.post("/api/imports/csv", async (context) => {
    const payload = csvImportSchema.parse(await context.req.json());
    const result = parseActualsCsv(payload.csv);
    repo.replaceActuals(result.rows);
    return context.json({ diagnostics: result.diagnostics });
  });

  app.get("/api/cube/actuals", (context) => {
    return context.json({ rows: repo.listActuals(), summary: repo.getMetricSummary() });
  });

  app.get("/api/cube/forecast", (context) => {
    const scenario = context.req.query("scenario");
    return context.json({
      rows: repo.listForecast(scenario),
      summary: repo.getMetricSummary(scenario),
    });
  });

  app.get("/api/cube/variance", (context) => {
    const left = context.req.query("left") ?? "Base Case";
    const right = context.req.query("right") ?? "Aggressive Growth";
    return context.json({ rows: repo.compare(left, right), left, right });
  });

  app.get("/api/scenarios", (context) => {
    return context.json({ scenarios: repo.listScenarios() });
  });

  app.get("/api/versions", (context) => {
    return context.json({ versions: repo.listVersions() });
  });

  app.post("/api/versions", async (context) => {
    const payload = versionCreateSchema.parse(await context.req.json());
    try {
      return context.json(
        {
          version: repo.createVersion(payload.name, payload.sourceId),
          versions: repo.listVersions(),
        },
        201,
      );
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.patch("/api/versions/:id", async (context) => {
    const payload = versionUpdateSchema.parse(await context.req.json());
    try {
      return context.json({
        version: repo.updateVersion(context.req.param("id"), payload),
        versions: repo.listVersions(),
      });
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.delete("/api/versions/:id", (context) => {
    try {
      repo.deleteVersion(context.req.param("id"));
      return context.json({ ok: true, versions: repo.listVersions() });
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/dimensions", (context) => {
    return context.json(repo.listDimensions());
  });

  app.post("/api/dimensions/:kind/members", async (context) => {
    const kind = dimensionKindSchema.parse(context.req.param("kind"));
    const payload = dimensionMemberSchema.parse(await context.req.json());
    try {
      repo.createDimensionMember(kind, payload.name, payload.parentName ?? null);
      return context.json({ dimensions: repo.listDimensions() }, 201);
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.patch("/api/dimensions/:kind/members/:name", async (context) => {
    const kind = dimensionKindSchema.parse(context.req.param("kind"));
    const name = context.req.param("name");
    const payload = dimensionMemberUpdateSchema.parse(await context.req.json());
    try {
      repo.updateDimensionMember(kind, name, payload);
      return context.json({ dimensions: repo.listDimensions() });
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/dimensions/:kind/members/:name/impact", (context) => {
    const kind = dimensionKindSchema.parse(context.req.param("kind"));
    try {
      return context.json({ impact: repo.getDimensionImpact(kind, context.req.param("name")) });
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 404);
    }
  });

  app.delete("/api/dimensions/:kind/members/:name", (context) => {
    const kind = dimensionKindSchema.parse(context.req.param("kind"));
    try {
      const impact = repo.deleteDimensionMember(
        kind,
        context.req.param("name"),
        context.req.query("force") === "1",
      );
      return context.json({ ok: true, impact, dimensions: repo.listDimensions() });
    } catch (error) {
      if (error instanceof DimensionReferenceError) {
        return context.json({ error: error.message, impact: error.impact }, 409);
      }
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/scenarios/validate-formula", async (context) => {
    try {
      const payload = formulaValidateSchema.parse(await context.req.json());
      return context.json(repo.validateFormulaExpression(payload.formula, payload.account));
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/custom-variables", (context) => {
    return context.json({ customVariables: repo.listCustomVariables() });
  });

  app.post("/api/custom-variables/validate-formula", async (context) => {
    try {
      const payload = customVarValidateSchema.parse(await context.req.json());
      return context.json(repo.validateCustomVariableFormula(payload.formula, payload.availableIds));
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/custom-variables", async (context) => {
    try {
      const payload = customVarCreateSchema.parse(await context.req.json());
      const def = repo.createCustomVariable(payload);
      return context.json({ customVariable: def, customVariables: repo.listCustomVariables() }, 201);
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.put("/api/custom-variables/:id", async (context) => {
    try {
      const payload = customVarUpdateSchema.parse(await context.req.json());
      const def = repo.updateCustomVariable(context.req.param("id"), payload);
      return context.json({ customVariable: def, customVariables: repo.listCustomVariables() });
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.delete("/api/custom-variables/:id", (context) => {
    try {
      repo.deleteCustomVariable(context.req.param("id"));
      return context.json({ ok: true, customVariables: repo.listCustomVariables() });
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/scenarios", async (context) => {
    const scenario = scenarioSchema.parse(await context.req.json());
    try {
      return context.json({ scenario: repo.upsertScenario(scenario) }, 201);
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.put("/api/scenarios/:id", async (context) => {
    const scenario = scenarioSchema.parse(await context.req.json());
    try {
      return context.json({ scenario: repo.upsertScenario(scenario) });
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/scenarios/:id/recalculate", (context) => {
    const scenario = repo.listScenarios().find((item) => item.id === context.req.param("id"));
    if (!scenario) {
      return context.json({ error: "Scenario not found." }, 404);
    }
    try {
      repo.recalculateScenario(scenario.name);
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
    return context.json({ ok: true });
  });

  app.post("/api/analyst/ask", async (context) => {
    try {
      const payload = analystSchema.parse(await context.req.json());
      return context.json(
        await analyst.ask(payload.question, {
          scenario: payload.scenario,
          compareScenario: payload.compareScenario,
        }),
      );
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  return app;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}
