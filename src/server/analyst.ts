import { GoogleGenAI, Type } from "@google/genai";
import type { Repository } from "./repository.ts";

export type AnalystAnswer = {
  answer: string;
  citations: { tool: string; label: string; value: number | string }[];
  provider: "local" | "gemini";
};

export type Analyst = {
  ask(question: string, context: { scenario?: string }): Promise<AnalystAnswer>;
};

export function createAnalyst(repo: Repository): Analyst {
  if (process.env.GEMINI_API_KEY) {
    return new GeminiAnalyst(
      repo,
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_MODEL ?? "gemini-3-flash-preview",
    );
  }
  return new LocalGroundedAnalyst(repo);
}

class LocalGroundedAnalyst implements Analyst {
  private readonly repo: Repository;

  constructor(repo: Repository) {
    this.repo = repo;
  }

  async ask(question: string, context: { scenario?: string }): Promise<AnalystAnswer> {
    const summary = this.repo.getMetricSummary(context.scenario);
    const lowered = question.toLowerCase();
    const department = summary.departments.find((item) =>
      lowered.includes(item.department.toLowerCase()),
    );
    const scoped = department ?? summary.departments[0];
    const grossMargin = scoped.revenue - scoped.cogs;
    const grossMarginPct = scoped.revenue === 0 ? null : grossMargin / scoped.revenue;
    const label = context.scenario ? `${context.scenario} forecast` : "historical actuals";

    const answer = department
      ? `${scoped.department} ${label}: revenue is ${formatCurrency(scoped.revenue)}, COGS is ${formatCurrency(scoped.cogs)}, and gross margin is ${formatCurrency(grossMargin)}${grossMarginPct === null ? "" : ` (${formatPercent(grossMarginPct)})`}.`
      : `${label}: total revenue is ${formatCurrency(summary.kpis.revenue)}, gross margin is ${formatCurrency(summary.kpis.grossMargin)}${summary.kpis.grossMarginPct === null ? "" : ` (${formatPercent(summary.kpis.grossMarginPct)})`}, OpEx is ${formatCurrency(summary.kpis.opex)}, and headcount is ${formatNumber(summary.kpis.headcount)}.`;

    return {
      answer,
      provider: "local",
      citations: [
        {
          tool: "getMetricSummary",
          label: department ? `${scoped.department} revenue` : "Total revenue",
          value: department ? scoped.revenue : summary.kpis.revenue,
        },
        {
          tool: "getMetricSummary",
          label: department ? `${scoped.department} COGS` : "Total COGS",
          value: department ? scoped.cogs : summary.kpis.cogs,
        },
      ],
    };
  }
}

class GeminiAnalyst implements Analyst {
  private readonly client: GoogleGenAI;
  private readonly repo: Repository;
  private readonly model: string;

  constructor(repo: Repository, apiKey: string, model: string) {
    this.repo = repo;
    this.model = model;
    this.client = new GoogleGenAI({ apiKey });
  }

  async ask(question: string, context: { scenario?: string }): Promise<AnalystAnswer> {
    const getMetricSummaryDeclaration = {
      name: "getMetricSummary",
      description: "Return grounded aggregate FP&A metrics from the imported planning cube.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          scenario: {
            type: Type.STRING,
            description: "Optional scenario name. Omit for historical actuals.",
          },
        },
      },
    };
    const summary = this.repo.getMetricSummary(context.scenario);
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are a guarded FP&A analyst. Answer only from tool results. If you need data, call getMetricSummary. User question: ${question}`,
            },
          ],
        },
      ],
      config: {
        tools: [{ functionDeclarations: [getMetricSummaryDeclaration] }],
      },
    });

    const requestedTool = response.functionCalls?.[0]?.name === "getMetricSummary";
    if (!requestedTool) {
      return new LocalGroundedAnalyst(this.repo).ask(question, context);
    }

    const second = await this.client.models.generateContent({
      model: this.model,
      contents: [
        { role: "user", parts: [{ text: question }] },
        {
          role: "user",
          parts: [
            {
              text: `Tool result from getMetricSummary: ${JSON.stringify(summary)}. Write a concise answer and mention only these metrics.`,
            },
          ],
        },
      ],
    });

    return {
      answer: second.text ?? "The analyst could not produce an answer from the available metrics.",
      provider: "gemini",
      citations: [
        { tool: "getMetricSummary", label: "Total revenue", value: summary.kpis.revenue },
        { tool: "getMetricSummary", label: "Gross margin", value: summary.kpis.grossMargin },
      ],
    };
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
