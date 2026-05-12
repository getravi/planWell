import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { detectAnomalies } from "../domain/anomaly.ts";
import type { Repository } from "./repository.ts";

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

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro-preview-06-05";
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

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

  async ask(
    question: string,
    context: { scenario?: string; compareScenario?: string },
  ): Promise<AnalystAnswer> {
    const summary = this.repo.getMetricSummary(context.scenario);
    const systemContext = `You are a guarded FP&A analyst. You MUST call getMetricSummary to retrieve data before answering. Current context: scenario="${context.scenario ?? "actuals"}"${context.compareScenario ? `, compareScenario="${context.compareScenario}"` : ""}.`;

    const answer = await this.client.models.generateContent({
      model: this.getModel(),
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${systemContext}\n\nTool result from getMetricSummary: ${JSON.stringify(summary)}\n\nUser question: ${question}\n\nAnswer concisely using only the tool data above.`,
            },
          ],
        },
      ],
    });

    return {
      answer: answer.text ?? "The analyst could not produce an answer from the available metrics.",
      provider: "gemini",
      citations: [
        { tool: "getMetricSummary", label: "Total revenue", value: summary.kpis.revenue },
        { tool: "getMetricSummary", label: "Gross margin", value: summary.kpis.grossMargin },
      ],
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
    const systemPrompt = `You are a guarded FP&A analyst. Answer ONLY from tool results. Be concise and cite specific numbers. Current context: scenario="${context.scenario ?? "actuals"}"${context.compareScenario ? `, compareScenario="${context.compareScenario}"` : ""}.`;

    const priorMessages: Anthropic.MessageParam[] = (context.history ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const messages: Anthropic.MessageParam[] = [...priorMessages, { role: "user", content: question }];

    for (let i = 0; i < 5; i++) {
      const response = await this.client.messages.create({
        model: this.getModel(),
        max_tokens: 1024,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        tools: CLAUDE_TOOLS.map((t) => ({ ...t, cache_control: { type: "ephemeral" } as const })),
        messages,
        // Force at least one tool call on the first turn so answers are grounded in real data
        ...(i === 0 ? { tool_choice: { type: "any" as const } } : {}),
      });

      if (response.stop_reason === "end_turn") {
        const textBlock = response.content.find((b) => b.type === "text");
        return {
          answer: textBlock?.type === "text" ? textBlock.text : "No answer produced.",
          provider: "claude",
          citations: [],
        };
      }

      if (response.stop_reason === "tool_use") {
        const assistantContent: Anthropic.ContentBlock[] = response.content;
        messages.push({ role: "assistant", content: assistantContent });

        const toolResults: Anthropic.ToolResultBlockParam[] = response.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
          .map((b) => ({
            type: "tool_result" as const,
            tool_use_id: b.id,
            content: JSON.stringify(this.callTool(b.name, b.input as Record<string, unknown>)),
          }));

        messages.push({ role: "user", content: toolResults });
        continue;
      }

      break;
    }

    return {
      answer: "The AI analyst could not produce a grounded answer. Please try again.",
      provider: "claude",
      citations: [],
    };
  }
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
