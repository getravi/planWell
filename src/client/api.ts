import type {
  ActualRow,
  CoreAccount,
  CustomVariableDef,
  DimensionImpact,
  DimensionKind,
  Dimensions,
  ForecastRow,
  KpiSummary,
  ScenarioAssumptions,
  VarianceRow,
} from "../domain/types.ts";
export type { AnomalyFlag } from "../domain/anomaly.ts";
export type { BaselineSuggestions } from "../domain/baseline.ts";
export type { NarrativeReport } from "../server/analyst.ts";

export type ScenarioRecord = {
  id: string;
  name: string;
  locked: boolean;
  assumptions: ScenarioAssumptions;
  updatedAt?: string;
};

export type VersionRecord = {
  id: string;
  name: string;
  kind: "actuals" | "scenario";
  locked: boolean;
  sortOrder: number;
  canLock: boolean;
  canRename: boolean;
  canDelete: boolean;
  updatedAt?: string;
};

export type MetricSummary = {
  kpis: KpiSummary;
  accounts: {
    account: string;
    value: number;
  }[];
  departments: {
    department: string;
    revenue: number;
    cogs: number;
    opex: number;
    headcount: number;
  }[];
  months: string[];
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    throw new Error(
      (await response.json().catch(() => ({ error: response.statusText }))).error ??
        response.statusText,
    );
  }
  return response.json() as Promise<T>;
}

export const client = {
  me: () => api<{ user: { email: string } }>("/api/auth/me"),
  login: (email: string, password: string) =>
    api<{ user: { email: string } }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  importCsv: (csv: string) =>
    api<{
      diagnostics: { rowsImported: number; rowsRead: number; shape: string; warnings: string[] };
    }>("/api/imports/csv", {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),
  actuals: () => api<{ rows: ActualRow[]; summary: MetricSummary }>("/api/cube/actuals"),
  forecast: (scenario: string) =>
    api<{ rows: ForecastRow[]; summary: MetricSummary }>(
      `/api/cube/forecast?scenario=${encodeURIComponent(scenario)}`,
    ),
  variance: (left: string, right: string) =>
    api<{ rows: VarianceRow[]; left: string; right: string }>(
      `/api/cube/variance?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`,
    ),
  scenarios: () => api<{ scenarios: ScenarioRecord[] }>("/api/scenarios"),
  versions: () => api<{ versions: VersionRecord[] }>("/api/versions"),
  createVersion: (name: string, sourceId: string) =>
    api<{ version: VersionRecord; versions: VersionRecord[] }>("/api/versions", {
      method: "POST",
      body: JSON.stringify({ name, sourceId }),
    }),
  updateVersion: (id: string, changes: { name?: string; locked?: boolean; sortOrder?: number }) =>
    api<{ version: VersionRecord; versions: VersionRecord[] }>(`/api/versions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),
  deleteVersion: (id: string) =>
    api<{ ok: true; versions: VersionRecord[] }>(`/api/versions/${id}`, { method: "DELETE" }),
  dimensions: () => api<Dimensions>("/api/dimensions"),
  createDimensionMember: (kind: DimensionKind, name: string, parentName?: string | null) =>
    api<{ dimensions: Dimensions }>(`/api/dimensions/${kind}/members`, {
      method: "POST",
      body: JSON.stringify({ name, parentName: parentName ?? null }),
    }),
  updateDimensionMember: (
    kind: DimensionKind,
    name: string,
    changes: { name?: string; parentName?: string | null; sortOrder?: number },
  ) =>
    api<{ dimensions: Dimensions }>(`/api/dimensions/${kind}/members/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),
  dimensionImpact: (kind: DimensionKind, name: string) =>
    api<{ impact: DimensionImpact }>(
      `/api/dimensions/${kind}/members/${encodeURIComponent(name)}/impact`,
    ),
  deleteDimensionMember: (kind: DimensionKind, name: string, force = false) =>
    api<{ ok: true; impact: DimensionImpact; dimensions: Dimensions }>(
      `/api/dimensions/${kind}/members/${encodeURIComponent(name)}${force ? "?force=1" : ""}`,
      { method: "DELETE" },
    ),
  saveScenario: (scenario: ScenarioAssumptions) =>
    api<{ scenario: ScenarioRecord }>("/api/scenarios", {
      method: "POST",
      body: JSON.stringify(scenario),
    }),
  validateFormula: (formula: string, account: CoreAccount) =>
    api<{ ok: true } | { ok: false; error: string }>("/api/scenarios/validate-formula", {
      method: "POST",
      body: JSON.stringify({ formula, account }),
    }),
  listCustomVariables: () =>
    api<{ customVariables: CustomVariableDef[] }>("/api/custom-variables"),
  createCustomVariable: (def: CustomVariableDef) =>
    api<{ customVariable: CustomVariableDef; customVariables: CustomVariableDef[] }>(
      "/api/custom-variables",
      { method: "POST", body: JSON.stringify(def) },
    ),
  updateCustomVariable: (
    id: string,
    patch: { label?: string; formula?: string; sortOrder?: number; defaultValue?: number },
  ) =>
    api<{ customVariable: CustomVariableDef; customVariables: CustomVariableDef[] }>(
      `/api/custom-variables/${id}`,
      { method: "PUT", body: JSON.stringify(patch) },
    ),
  deleteCustomVariable: (id: string) =>
    api<{ ok: true; customVariables: CustomVariableDef[] }>(`/api/custom-variables/${id}`, {
      method: "DELETE",
    }),
  validateCustomFormula: (formula: string, availableIds: string[]) =>
    api<{ ok: true } | { ok: false; error: string }>("/api/custom-variables/validate-formula", {
      method: "POST",
      body: JSON.stringify({ formula, availableIds }),
    }),
  ask: (question: string, scenario?: string, compareScenario?: string, history?: { role: "user" | "assistant"; content: string }[]) =>
    api<{
      answer: string;
      provider: string;
      citations: { tool: string; label: string; value: number | string }[];
    }>("/api/analyst/ask", {
      method: "POST",
      body: JSON.stringify({ question, scenario, compareScenario, history }),
    }),
  settings: () => api<{ forecastHorizon: number; aiModel: string | null; lastActualsMonth: string | null }>("/api/settings"),
  updateSettings: (patch: { forecastHorizon?: number; aiModel?: string; lastActualsMonth?: string | null }) =>
    api<{ forecastHorizon: number; aiModel: string | null; lastActualsMonth: string | null }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  aiProviders: () =>
    api<{
      providers: { id: string; label: string; models: { id: string; label: string }[] }[];
      selectedModel: string | null;
    }>("/api/settings/ai-providers"),
  backupUrl: "/api/admin/backup",
  restoreUrl: "/api/admin/restore",
  anomalies: () => api<{ anomalies: import("../domain/anomaly.ts").AnomalyFlag[] }>("/api/anomalies"),
  baselineSuggestions: () => api<import("../domain/baseline.ts").BaselineSuggestions>("/api/forecast/baseline-suggestions"),
  generateNarrative: (scenario: string, compareScenario?: string) =>
    api<import("../server/analyst.ts").NarrativeReport>("/api/analyst/narrative", {
      method: "POST",
      body: JSON.stringify({ scenario, compareScenario }),
    }),
};
