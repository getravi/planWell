import { writeFileSync } from "node:fs";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { parseActualsCsv } from "../domain/importer.ts";
import { detectAnomalies } from "../domain/anomaly.ts";
import { suggestDrivers } from "../domain/baseline.ts";
import { coreAccounts, type ScenarioAssumptions } from "../domain/types.ts";
import { createAnalyst, generateNarrative, listAvailableModels, type Analyst } from "./analyst.ts";
import { logger } from "../logger.ts";
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

const partialVarValuesSchema = z.record(z.string(), z.number().optional());

const scenarioSchema: z.ZodType<ScenarioAssumptions> = z.object({
  name: z.string().min(1),
  varOverrides: z
    .record(
      z.string(),
      z.object({
        monthly: z.record(z.string(), partialVarValuesSchema).optional(),
      }),
    )
    .optional(),
  formulas: z.record(coreAccountEnum, z.string().min(1)).optional(),
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
  defaultValue: z.number().optional(),
});

const settingsPatchSchema = z.object({
  forecastHorizon: z.number().int().min(1).max(60).optional(),
  aiModel: z.string().optional(),
  lastActualsMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullable()
    .optional(),
});

const customVarValidateSchema = z.object({
  formula: z.string().min(1),
  availableIds: z.array(z.string()),
});

const formulaValidateSchema = z.object({
  formula: z.string().min(1),
  account: coreAccountEnum,
});

const chatMessageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string() });
const analystSchema = z.object({
  question: z.string().min(1),
  scenario: z.string().optional(),
  compareScenario: z.string().optional(),
  history: z.array(chatMessageSchema).optional(),
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

export function createApp({
  repo,
  analyst: injectedAnalyst,
}: {
  repo: Repository;
  analyst?: Analyst;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const analyst = injectedAnalyst ?? createAnalyst(repo);

  const recalcSubs = new Set<(scenarioName: string) => void>();
  function notifyRecalcDone(scenarioName: string) {
    for (const fn of recalcSubs) {
      try {
        fn(scenarioName);
      } catch {
        /* subscriber closed */
      }
    }
  }
  function bgRecalcScenario(scenarioName: string) {
    setImmediate(() => {
      try {
        repo.recalculateScenario(scenarioName);
        notifyRecalcDone(scenarioName);
        logger.info({ scenario: scenarioName }, "bg-recalc.scenario.done");
      } catch (err) {
        logger.error({ err, scenario: scenarioName }, "bg-recalc.scenario.failed");
      }
    });
  }
  function bgRecalcAll() {
    setImmediate(() => {
      try {
        repo.recalculateAllScenarios();
        notifyRecalcDone("*");
        logger.info("bg-recalc.all.done");
      } catch (err) {
        logger.error({ err }, "bg-recalc.all.failed");
      }
    });
  }

  app.use("*", secureHeaders());

  app.use("/api/*", async (context, next) => {
    const t0 = Date.now();
    await next();
    logger.info(
      {
        method: context.req.method,
        path: new URL(context.req.url).pathname,
        status: context.res.status,
        ms: Date.now() - t0,
      },
      "http",
    );
  });

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
      secure: new URL(context.req.url).protocol === "https:",
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
    try {
      const payload = csvImportSchema.parse(await context.req.json());
      const result = parseActualsCsv(payload.csv);
      repo.replaceActuals(result.rows);
      return context.json({ diagnostics: result.diagnostics });
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/cube/actuals", (context) => {
    return context.json({ rows: repo.listActuals(), summary: repo.getMetricSummary() });
  });

  app.get("/api/anomalies", (context) => {
    return context.json({ anomalies: detectAnomalies(repo.listActuals()) });
  });

  app.get("/api/forecast-updates", (_c) => {
    const encoder = new TextEncoder();
    let sub: ((name: string) => void) | null = null;
    let heartbeatId: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        sub = (scenarioName: string) => {
          try {
            controller.enqueue(encoder.encode(`event: recalc-done\ndata: ${scenarioName}\n\n`));
          } catch {
            /* stream closed */
          }
        };
        recalcSubs.add(sub);
        heartbeatId = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          } catch {
            if (heartbeatId) clearInterval(heartbeatId);
          }
        }, 25000);
      },
      cancel() {
        if (sub) recalcSubs.delete(sub);
        if (heartbeatId) clearInterval(heartbeatId);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  app.get("/api/forecast/baseline-suggestions", (context) => {
    return context.json(suggestDrivers(repo.listActuals()));
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
      if (kind === "time") bgRecalcAll();
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
      return context.json(
        repo.validateCustomVariableFormula(payload.formula, payload.availableIds),
      );
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/custom-variables", async (context) => {
    try {
      const payload = customVarCreateSchema.parse(await context.req.json());
      const def = repo.createCustomVariable(payload);
      return context.json(
        { customVariable: def, customVariables: repo.listCustomVariables() },
        201,
      );
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
      const record = repo.saveScenarioAssumptions(scenario);
      bgRecalcScenario(record.name);
      return context.json({ scenario: record, recalculating: true }, 201);
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.put("/api/scenarios/:id", async (context) => {
    const scenario = scenarioSchema.parse(await context.req.json());
    if (context.req.param("id") !== scenario.name) {
      return context.json({ error: "URL id must match scenario name in body." }, 400);
    }
    try {
      const record = repo.saveScenarioAssumptions(scenario);
      bgRecalcScenario(record.name);
      return context.json({ scenario: record, recalculating: true });
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/scenarios/:id/recalculate", (context) => {
    let scenario: ReturnType<typeof repo.getScenarioById>;
    try {
      scenario = repo.getScenarioById(context.req.param("id"));
    } catch {
      return context.json({ error: "Scenario not found." }, 404);
    }
    try {
      repo.recalculateScenario(scenario.name);
      return context.json({ ok: true });
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/analyst/ask", async (context) => {
    try {
      const payload = analystSchema.parse(await context.req.json());
      return context.json(
        await analyst.ask(payload.question, {
          scenario: payload.scenario,
          compareScenario: payload.compareScenario,
          history: payload.history,
        }),
      );
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/analyst/narrative", async (context) => {
    try {
      const { scenario, compareScenario, periodLabel } = z
        .object({
          scenario: z.string().min(1),
          compareScenario: z.string().optional(),
          periodLabel: z.string().optional(),
        })
        .parse(await context.req.json());
      return context.json(await generateNarrative(repo, scenario, compareScenario, periodLabel));
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  function parseSettings(raw: Record<string, string>) {
    const horizon = raw.forecastHorizon ? parseInt(raw.forecastHorizon, 10) : 12;
    return {
      forecastHorizon: Number.isFinite(horizon) ? horizon : 12,
      aiModel: raw.aiModel ?? null,
      lastActualsMonth: raw.lastActualsMonth ?? null,
    };
  }

  app.get("/api/settings", (context) => {
    return context.json(parseSettings(repo.getSettings()));
  });

  app.patch("/api/settings", async (context) => {
    try {
      const payload = settingsPatchSchema.parse(await context.req.json());
      const patch: Record<string, string> = {};
      if (payload.forecastHorizon !== undefined) {
        patch.forecastHorizon = String(payload.forecastHorizon);
      }
      if (payload.aiModel !== undefined) {
        patch.aiModel = payload.aiModel;
      }
      if (payload.lastActualsMonth !== undefined) {
        patch.lastActualsMonth = payload.lastActualsMonth ?? "";
      }
      if (Object.keys(patch).length > 0) {
        repo.updateSettings(patch);
        if (payload.forecastHorizon !== undefined) {
          bgRecalcAll();
        }
      }
      return context.json(parseSettings(repo.getSettings()));
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/settings/ai-providers", async (context) => {
    const raw = repo.getSettings();
    const { providers } = await listAvailableModels();
    return context.json({ providers, selectedModel: raw.aiModel ?? null });
  });

  app.use("/api/admin/*", async (context, next) => {
    const adminKey = process.env.ADMIN_KEY;
    if (adminKey && context.req.header("x-admin-key") !== adminKey) {
      return context.json({ error: "Forbidden." }, 403);
    }
    await next();
  });

  app.get("/api/admin/backup", (context) => {
    try {
      const data = repo.backup();
      const ab = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer;
      const date = new Date().toISOString().slice(0, 10);
      return new Response(ab, {
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="planwell-backup-${date}.sqlite"`,
          "content-length": String(data.byteLength),
        },
      });
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 500);
    }
  });

  app.post("/api/admin/restore", async (context) => {
    const dbPath = process.env.SQLITE_PATH;
    if (!dbPath) {
      return context.json(
        { error: "SQLITE_PATH not set — restore not supported in this environment" },
        400,
      );
    }
    try {
      const form = await context.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return context.json({ error: "No file uploaded" }, 400);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const magic = Buffer.from("SQLite format 3\0");
      if (bytes.length < 16 || !magic.equals(Buffer.from(bytes.slice(0, 16)))) {
        return context.json({ error: "Not a valid SQLite database file" }, 400);
      }
      writeFileSync(dbPath, bytes);
      setTimeout(() => process.exit(0), 200);
      return context.json({ ok: true });
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 500);
    }
  });

  return app;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}
