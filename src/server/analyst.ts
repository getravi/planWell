import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, Type } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";
import { detectAnomalies } from "../domain/anomaly.ts";
import type { Repository } from "./repository.ts";
import { logger } from "../logger.ts";

export type AnalystAnswer = {
  answer: string;
  citations: { tool: string; label: string; value: number | string }[];
  provider: "local" | "gemini" | "claude";
};

export type NarrativeSection = { title: string; body: string };
export type NarrativeReport = {
  headline: string;
  sections: NarrativeSection[];
  risks: string[];
  provider: "claude" | "gemini" | "local";
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type Analyst = {
  ask(
    question: string,
    context: { scenario?: string; compareScenario?: string; history?: ChatMessage[] },
  ): Promise<AnalystAnswer>;
};

export const DEFAULT_GEMINI_MODEL = "gemini-3.1-pro-preview";
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

export function createLocalAnalyst(repo: Repository): Analyst {
  return {
    async ask(question, context) {
      if (context.scenario && context.compareScenario) {
        const rows = repo.compare(context.scenario, context.compareScenario).filter((r) => r.variance !== 0);
        const top = [...rows].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))[0];
        const answer = top
          ? `${context.scenario} vs ${context.compareScenario}: largest variance is ${top.account} for ${top.department} in ${top.month} (${top.variance >= 0 ? "+" : ""}${top.variance.toFixed(0)}).`
          : `${context.scenario} vs ${context.compareScenario}: no material variances found.`;
        return { answer, provider: "local", citations: [{ tool: "compareScenarios", label: `${context.scenario} vs ${context.compareScenario}`, value: rows.length }] };
      }
      const summary = repo.getMetricSummary(context.scenario);
      const lowered = question.toLowerCase();
      const dept = summary.departments.find((d) => lowered.includes(d.department.toLowerCase()));
      const label = context.scenario ?? "actuals";
      const answer = dept
        ? `${dept.department} (${label}): revenue ${dept.revenue.toFixed(0)}, COGS ${dept.cogs.toFixed(0)}, gross margin ${(dept.revenue - dept.cogs).toFixed(0)}.`
        : `${label}: total revenue ${summary.kpis.revenue.toFixed(0)}, gross margin ${summary.kpis.grossMargin.toFixed(0)}.`;
      return { answer, provider: "local", citations: [{ tool: "getMetricSummary", label: dept?.department ?? label, value: dept?.revenue ?? summary.kpis.revenue }] };
    },
  };
}

export function createAnalyst(repo: Repository): Analyst {
  if (process.env.ANTHROPIC_API_KEY) {
    return new ClaudeAnalyst(repo, process.env.ANTHROPIC_API_KEY);
  }
  if (process.env.GEMINI_API_KEY) {
    return new GeminiAnalyst(repo, process.env.GEMINI_API_KEY);
  }
  return {
    async ask() {
      return {
        answer: "No AI provider configured. Set ANTHROPIC_API_KEY or GEMINI_API_KEY to enable the analyst.",
        provider: "local" as const,
        citations: [],
      };
    },
  };
}


const GEMINI_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "getMetricSummary",
    description: "Return aggregate FP&A KPIs and department breakdown for a scenario or actuals.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        scenario: { type: Type.STRING, description: "Scenario name. Omit for historical actuals." },
      },
    },
  },
  {
    name: "listActuals",
    description: "Return all historical actual rows (month, department, account, value).",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "compareScenarios",
    description: "Return variance rows between two scenarios.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        left: { type: Type.STRING, description: "Left scenario name (or 'actuals')." },
        right: { type: Type.STRING, description: "Right scenario name." },
      },
      required: ["left", "right"],
    },
  },
  {
    name: "detectAnomalies",
    description: "Return anomaly flags from historical actuals.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

class GeminiAnalyst implements Analyst {
  private readonly client: GoogleGenAI;
  private readonly repo: Repository;

  constructor(repo: Repository, apiKey: string) {
    this.repo = repo;
    this.client = new GoogleGenAI({ apiKey });
  }

  private getModel(): string {
    return this.repo.getSettings().aiModel ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  }

  private callTool(name: string, args: Record<string, unknown>): unknown {
    if (name === "getMetricSummary") return this.repo.getMetricSummary(args.scenario as string | undefined);
    if (name === "listActuals") return this.repo.listActuals();
    if (name === "compareScenarios") return this.repo.compare(args.left as string, args.right as string);
    if (name === "detectAnomalies") return detectAnomalies(this.repo.listActuals());
    return null;
  }

  async ask(
    question: string,
    _context: { scenario?: string; compareScenario?: string },
  ): Promise<AnalystAnswer> {
    const model = this.getModel();
    const availableScenarios = this.repo.listScenarios().map((s) => s.name);
    const systemInstruction = `You are a guarded FP&A analyst with access to all planning data. Answer ONLY from tool results. Be concise and cite specific numbers. Available scenarios: ${availableScenarios.join(", ") || "none"}.`;

    const contents: { role: string; parts: Record<string, unknown>[] }[] = [
      { role: "user", parts: [{ text: question }] },
    ];

    const citationsCollected: AnalystAnswer["citations"] = [];
    const t0 = Date.now();

    for (let i = 0; i < 5; i++) {
      const response = await this.client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS }],
        },
      });

      const calls = response.functionCalls;
      if (!calls || calls.length === 0) {
        const text = response.text ?? "The analyst could not produce an answer.";
        logger.info({ provider: "gemini", model, iterations: i + 1, ms: Date.now() - t0 }, "analyst.ask");
        return { answer: text, provider: "gemini", citations: citationsCollected };
      }

      // Preserve raw parts (including thoughtSignature) so thinking models don't reject the next turn
      const rawParts = response.candidates?.[0]?.content?.parts as Record<string, unknown>[] | undefined;
      const modelParts = rawParts ?? calls.map((c) => ({ functionCall: { name: c.name, args: c.args } }));
      contents.push({ role: "model", parts: modelParts });

      const responseParts = calls.map((c) => {
        const result = this.callTool(c.name ?? "", (c.args ?? {}) as Record<string, unknown>);
        citationsCollected.push(...extractGeminiCitations(c.name ?? "", (c.args ?? {}) as Record<string, unknown>, result));
        return { functionResponse: { name: c.name, response: { result } } };
      });
      contents.push({ role: "user", parts: responseParts });
    }

    logger.warn({ provider: "gemini", model, ms: Date.now() - t0 }, "analyst.ask max iterations reached");
    return {
      answer: "The analyst could not produce a grounded answer. Please try again.",
      provider: "gemini",
      citations: citationsCollected,
    };
  }
}

const CLAUDE_TOOLS: Anthropic.Tool[] = [
  {
    name: "getMetricSummary",
    description: "Return aggregate FP&A KPIs and department breakdown for a scenario or actuals.",
    input_schema: {
      type: "object" as const,
      properties: {
        scenario: { type: "string", description: "Scenario name. Omit for historical actuals." },
      },
    },
  },
  {
    name: "listActuals",
    description: "Return all historical actual rows (month, department, account, value).",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "compareScenarios",
    description: "Return variance rows between two scenarios or actuals.",
    input_schema: {
      type: "object" as const,
      properties: {
        left: { type: "string", description: "Left scenario name (or 'actuals')." },
        right: { type: "string", description: "Right scenario name." },
      },
      required: ["left", "right"],
    },
  },
  {
    name: "detectAnomalies",
    description: "Return anomaly flags from historical actuals (statistical outliers and MoM spikes).",
    input_schema: { type: "object" as const, properties: {} },
  },
];

class ClaudeAnalyst implements Analyst {
  private readonly client: Anthropic;
  private readonly repo: Repository;

  constructor(repo: Repository, apiKey: string) {
    this.repo = repo;
    this.client = new Anthropic({ apiKey });
  }

  private getModel(): string {
    return this.repo.getSettings().aiModel ?? DEFAULT_CLAUDE_MODEL;
  }

  private callTool(name: string, input: Record<string, unknown>): unknown {
    if (name === "getMetricSummary") {
      return this.repo.getMetricSummary(input.scenario as string | undefined);
    }
    if (name === "listActuals") {
      return this.repo.listActuals();
    }
    if (name === "compareScenarios") {
      return this.repo.compare(input.left as string, input.right as string);
    }
    if (name === "detectAnomalies") {
      return detectAnomalies(this.repo.listActuals());
    }
    return null;
  }

  async ask(
    question: string,
    context: { scenario?: string; compareScenario?: string; history?: ChatMessage[] },
  ): Promise<AnalystAnswer> {
    const model = this.getModel();
    const availableScenarios = this.repo.listScenarios().map((s) => s.name);
    const scenarioList = availableScenarios.length > 0 ? availableScenarios.join(", ") : "none";
    const systemPrompt = `You are a guarded FP&A analyst with access to all planning data. Answer ONLY from tool results. Be concise and cite specific numbers. Available scenarios: ${scenarioList}. Use getMetricSummary(scenario), listActuals, compareScenarios, or detectAnomalies to retrieve whatever data is relevant to the question.`;

    const priorMessages: Anthropic.MessageParam[] = (context.history ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const messages: Anthropic.MessageParam[] = [...priorMessages, { role: "user", content: question }];
    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];
    const t0 = Date.now();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let i = 0; i < 5; i++) {
      const response = await this.client.messages.create({
        model,
        max_tokens: 1024,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        tools: CLAUDE_TOOLS.map((t) => ({ ...t, cache_control: { type: "ephemeral" } as const })),
        messages,
        ...(i === 0 ? { tool_choice: { type: "any" as const } } : {}),
      });

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      if (response.stop_reason === "end_turn") {
        const textBlock = response.content.find((b) => b.type === "text");
        logger.info({ provider: "claude", model, iterations: i + 1, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, ms: Date.now() - t0 }, "analyst.ask");
        return {
          answer: textBlock?.type === "text" ? textBlock.text : "No answer produced.",
          provider: "claude",
          citations: buildClaudeCitations(toolUseBlocks),
        };
      }

      if (response.stop_reason === "tool_use") {
        const assistantContent: Anthropic.ContentBlock[] = response.content;
        messages.push({ role: "assistant", content: assistantContent });

        const newToolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        toolUseBlocks.push(...newToolUses);

        const toolResults: Anthropic.ToolResultBlockParam[] = newToolUses.map((b) => ({
          type: "tool_result" as const,
          tool_use_id: b.id,
          content: JSON.stringify(this.callTool(b.name, b.input as Record<string, unknown>)),
        }));

        messages.push({ role: "user", content: toolResults });
        continue;
      }

      break;
    }

    logger.warn({ provider: "claude", model, ms: Date.now() - t0 }, "analyst.ask max iterations reached");
    return {
      answer: "The AI analyst could not produce a grounded answer. Please try again.",
      provider: "claude",
      citations: buildClaudeCitations(toolUseBlocks),
    };
  }
}

function buildClaudeCitations(toolUses: Anthropic.ToolUseBlock[]): AnalystAnswer["citations"] {
  return toolUses.map((b) => {
    const input = b.input as Record<string, unknown>;
    return { tool: b.name, label: citationLabel(b.name, input), value: citationValue(b.name, input) };
  });
}

function extractGeminiCitations(
  name: string,
  args: Record<string, unknown>,
  result: unknown,
): AnalystAnswer["citations"] {
  return [{ tool: name, label: citationLabel(name, args), value: citationValue(name, args, result) }];
}

function citationLabel(tool: string, input: Record<string, unknown>): string {
  if (tool === "getMetricSummary") return input.scenario ? `${input.scenario} summary` : "Actuals summary";
  if (tool === "compareScenarios") return `${String(input.left)} vs ${String(input.right)}`;
  if (tool === "listActuals") return "Historical actuals";
  if (tool === "detectAnomalies") return "Anomaly scan";
  return tool;
}

function citationValue(tool: string, _input: Record<string, unknown>, result?: unknown): string | number {
  if (tool === "getMetricSummary" && result && typeof result === "object") {
    const r = result as { kpis?: { revenue?: number } };
    return r.kpis?.revenue ?? "—";
  }
  if (tool === "compareScenarios" && Array.isArray(result)) return `${result.length} variance rows`;
  if (tool === "listActuals" && Array.isArray(result)) return `${result.length} rows`;
  if (tool === "detectAnomalies" && Array.isArray(result)) return `${result.length} flags`;
  return "—";
}

export async function generateNarrative(
  repo: Repository,
  scenario: string,
  compareScenario?: string,
  periodLabel?: string,
): Promise<NarrativeReport> {
  const summary = repo.getMetricSummary(scenario);
  const anomalies = detectAnomalies(repo.listActuals());
  const variance = compareScenario ? repo.compare(compareScenario, scenario) : [];

  const context = {
    scenario,
    compareScenario,
    periodLabel,
    summary,
    topAnomalies: anomalies.slice(0, 5),
    topVariances: [...variance]
      .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
      .slice(0, 10),
  };

  const selectedModel = repo.getSettings().aiModel ?? null;

  if (process.env.ANTHROPIC_API_KEY) {
    return generateNarrativeClaude(context, process.env.ANTHROPIC_API_KEY, selectedModel ?? DEFAULT_CLAUDE_MODEL);
  }
  if (process.env.GEMINI_API_KEY) {
    return generateNarrativeGemini(context, process.env.GEMINI_API_KEY, selectedModel ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL);
  }
  return generateNarrativeLocal(context);
}

async function generateNarrativeClaude(
  ctx: ReturnType<typeof buildNarrativeContext>,
  apiKey: string,
  model: string,
): Promise<NarrativeReport> {
  const client = new Anthropic({ apiKey });
  const prompt = buildNarrativePrompt(ctx);

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: "You are an FP&A analyst writing an executive narrative. Return ONLY valid JSON matching the schema: {\"headline\":string,\"sections\":[{\"title\":string,\"body\":string}],\"risks\":[string]}. No markdown fences.",
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  return { ...parseNarrativeJson(text), provider: "claude" };
}

async function generateNarrativeGemini(
  ctx: ReturnType<typeof buildNarrativeContext>,
  apiKey: string,
  model: string,
): Promise<NarrativeReport> {
  const genai = new GoogleGenAI({ apiKey });
  const prompt = buildNarrativePrompt(ctx);
  const response = await genai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  return { ...parseNarrativeJson(response.text ?? "{}"), provider: "gemini" };
}

function generateNarrativeLocal(ctx: ReturnType<typeof buildNarrativeContext>): NarrativeReport {
  const { summary, scenario } = ctx;
  const { kpis } = summary;
  return {
    provider: "local",
    headline: `${scenario}: revenue ${formatCurrency(kpis.revenue)}, gross margin ${kpis.grossMarginPct !== null ? formatPercent(kpis.grossMarginPct) : "N/A"}.`,
    sections: [
      {
        title: "Revenue",
        body: summary.departments
          .map((d) => `${d.department}: ${formatCurrency(d.revenue)}`)
          .join(", "),
      },
      {
        title: "Operating Expenses",
        body: `Total OpEx ${formatCurrency(kpis.opex)} with ${formatNumber(kpis.headcount)} headcount.`,
      },
    ],
    risks: ctx.topAnomalies.map((a) => `${a.department} ${a.account} ${a.month}: ${a.reason}`),
  };
}

type NarrativeContext = {
  scenario: string;
  compareScenario?: string;
  periodLabel?: string;
  summary: ReturnType<Repository["getMetricSummary"]>;
  topAnomalies: ReturnType<typeof detectAnomalies>;
  topVariances: ReturnType<Repository["compare"]>;
};

function buildNarrativeContext(ctx: NarrativeContext) { return ctx; }

function buildNarrativePrompt(ctx: NarrativeContext): string {
  return `Generate an executive narrative for the following planning data.
Scenario: ${ctx.scenario}${ctx.compareScenario ? ` vs ${ctx.compareScenario}` : ""}${ctx.periodLabel ? ` (${ctx.periodLabel})` : ""}

Summary metrics: ${JSON.stringify(ctx.summary)}
Top variances: ${JSON.stringify(ctx.topVariances)}
Anomalies: ${JSON.stringify(ctx.topAnomalies)}

Return JSON: {"headline":"<one sentence>","sections":[{"title":"Revenue","body":"..."},{"title":"Margin","body":"..."},{"title":"OpEx & Headcount","body":"..."}],"risks":["<risk1>","<risk2>"]}`;
}

function parseNarrativeJson(text: string): Omit<NarrativeReport, "provider"> {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(stripped) as Partial<NarrativeReport>;
    return {
      headline: parsed.headline ?? "",
      sections: parsed.sections ?? [],
      risks: parsed.risks ?? [],
    };
  } catch {
    return { headline: stripped.slice(0, 300), sections: [], risks: [] };
  }
}


type ProviderModel = { id: string; label: string };
type ProviderEntry = { id: string; label: string; models: ProviderModel[] };

export async function listAvailableModels(): Promise<{ providers: ProviderEntry[] }> {
  const providers: ProviderEntry[] = [];

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const page = await client.models.list({ limit: 100 });
      const models = page.data
        .filter((m) => m.id.startsWith("claude") && !m.id.includes("thinking"))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((m) => ({ id: m.id, label: m.display_name }));
      if (models.length > 0) providers.push({ id: "anthropic", label: "Anthropic", models });
    } catch { /* invalid key or API down */ }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}&pageSize=100`,
      );
      if (res.ok) {
        const data = await res.json() as {
          models?: { name: string; displayName: string; supportedGenerationMethods?: string[] }[];
        };
        const models = (data.models ?? [])
          .filter((m) => {
            const id = m.name.replace("models/", "");
            return (
              m.supportedGenerationMethods?.includes("generateContent") &&
              id.includes("-pro") &&
              !id.includes("image") &&
              !id.includes("tts") &&
              !id.includes("embedding") &&
              !id.includes("customtools")
            );
          })
          .map((m) => ({ id: m.name.replace("models/", ""), label: m.displayName }))
          .sort((a, b) => b.id.localeCompare(a.id));
        if (models.length > 0) providers.push({ id: "google", label: "Google Gemini", models });
      }
    } catch { /* invalid key or API down */ }
  }

  return { providers };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(
    value,
  );
}
