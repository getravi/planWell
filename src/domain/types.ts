export const coreAccounts = ["Revenue", "COGS", "OpEx", "Headcount"] as const;

export type CoreAccount = (typeof coreAccounts)[number];

export type ActualRow = {
  month: string;
  department: string;
  account: string;
  value: number;
};

export type ForecastRow = ActualRow;

export type ScenarioFormulas = Partial<Record<CoreAccount, string>>;

export type CustomVariableKind = "input" | "calculated";

export type CustomVariableDef = {
  id: string;
  label: string;
  kind: CustomVariableKind;
  formula?: string;
  defaultValue?: number;
};

export type VarValues = Record<string, number>;

export type ScenarioAssumptions = {
  name: string;
  varOverrides?: Record<string, { monthly?: Record<string, Partial<VarValues>> }>;
  formulas?: ScenarioFormulas;
};

export type ImportDiagnostics = {
  shape: "long" | "wide";
  rowsRead: number;
  rowsImported: number;
  departments: string[];
  accounts: string[];
  months: string[];
  warnings: string[];
};

export type ImportResult = {
  rows: ActualRow[];
  diagnostics: ImportDiagnostics;
};

export type VarianceRow = {
  month: string;
  department: string;
  account: string;
  leftValue: number;
  rightValue: number;
  variance: number;
  variancePct: number | null;
};

export type KpiSummary = {
  revenue: number;
  cogs: number;
  grossMargin: number;
  grossMarginPct: number | null;
  opex: number;
  opexRatio: number | null;
  headcount: number;
};

export type DimensionKind = "department" | "account" | "time";

export type DimensionMember = {
  name: string;
  parentName: string | null;
  sortOrder?: number;
  referenceCount: number;
  children: DimensionMember[];
};

export type DimensionImpact = {
  actualRows: number;
  forecastRows: number;
  scenarioOverrides: number;
  childCount: number;
};

export type Dimensions = Record<DimensionKind, DimensionMember[]>;
