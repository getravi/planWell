import { useMemo, useState } from "react";
import { ChevronDown, Copy, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DimensionMember, VarianceRow } from "../../domain/types.ts";
import {
  aggregateVarianceByMonth,
  buildVarianceGridMatrix,
  buildVarianceGridTsv,
  buildVarianceInsights,
  collapsePivotVarianceRowsToQuarters,
  collapsePivotVarianceRowsToMonthsWithYearTotal,
  copyGrid,
  describeVarianceInsight,
  getMonths,
  isFYPeriod,
  pivotVarianceRows,
  type Granularity,
  type VarianceInsight,
} from "../pivot.ts";
import { compactCurrency, currency, formatCell } from "../format.ts";
import { EmptyState, ExportMenu, GhostButton, Panel } from "../ui.tsx";
import { exportCsv, exportPdf, exportXlsx } from "../export.ts";
import { client, type NarrativeReport } from "../api.ts";

export function ScenarioComparisonPage({
  rows,
  left,
  right,
  departmentHierarchy,
  accountHierarchy,
}: {
  rows: VarianceRow[];
  left: string;
  right: string;
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
}) {
  const [report, setReport] = useState<NarrativeReport | null>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrativeError, setNarrativeError] = useState("");

  async function generateNarrative() {
    setNarrativeLoading(true);
    setNarrativeError("");
    try {
      setReport(await client.generateNarrative(right, left));
    } catch (err) {
      setNarrativeError(err instanceof Error ? err.message : String(err));
    } finally {
      setNarrativeLoading(false);
    }
  }

  return (
    <div className="grid two">
      <ScenarioComparison
        rows={rows}
        left={left}
        right={right}
        onGenerateNarrative={() => void generateNarrative()}
        narrativeLoading={narrativeLoading}
        narrativeReport={report}
        narrativeError={narrativeError}
      />
      <VarianceView
        rows={rows}
        left={left}
        right={right}
        departmentHierarchy={departmentHierarchy}
        accountHierarchy={accountHierarchy}
      />
    </div>
  );
}

function ScenarioComparison({
  rows,
  left,
  right,
  onGenerateNarrative,
  narrativeLoading,
  narrativeReport,
  narrativeError,
}: {
  rows: VarianceRow[];
  left: string;
  right: string;
  onGenerateNarrative: () => void;
  narrativeLoading: boolean;
  narrativeReport: NarrativeReport | null;
  narrativeError: string;
}) {
  const chartRows = useMemo(() => aggregateVarianceByMonth(rows, "Revenue"), [rows]);
  const [open, setOpen] = useState(true);
  const hasNarrative = narrativeLoading || narrativeReport || narrativeError;

  return (
    <Panel className="span-two">
      <div className="panel-heading">
        <h2>Compare scenarios</h2>
        <span>
          {left} vs {right}
        </span>
      </div>
      <ResponsiveContainer height={300}>
        <LineChart data={chartRows}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis tickFormatter={(value) => compactCurrency(Number(value))} />
          <Tooltip formatter={(value) => currency(Number(value))} />
          <Legend />
          <Line dataKey="leftValue" name={left} stroke="#166534" strokeWidth={2} />
          <Line dataKey="rightValue" name={right} stroke="#1d4ed8" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <GhostButton type="button" onClick={onGenerateNarrative} disabled={narrativeLoading}>
          <FileText size={15} /> {narrativeLoading ? "Generating…" : "Generate narrative"}
        </GhostButton>
        {hasNarrative && (
          <GhostButton type="button" onClick={() => setOpen((o) => !o)}>
            <ChevronDown size={15} className={open ? "chevron open" : "chevron"} />
            {open ? "Hide narrative" : "Show narrative"}
          </GhostButton>
        )}
      </div>
      {hasNarrative && open && (
        <div
          style={{ marginTop: 16, borderTop: "1px solid var(--border, #e2e8f0)", paddingTop: 16 }}
        >
          {narrativeLoading && <p className="muted">Generating narrative…</p>}
          {narrativeError && <p className="error">{narrativeError}</p>}
          {narrativeReport && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <GhostButton
                  type="button"
                  onClick={() => {
                    const text = [
                      narrativeReport.headline,
                      ...narrativeReport.sections.map((s) => `${s.title}\n${s.body}`),
                      narrativeReport.risks.length
                        ? `Risks & flags\n${narrativeReport.risks.join("\n")}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join("\n\n");
                    void navigator.clipboard.writeText(text);
                  }}
                >
                  <Copy size={14} /> Copy text
                </GhostButton>
              </div>
              <Md style={{ fontWeight: 600, fontSize: 15 }}>{narrativeReport.headline}</Md>
              {narrativeReport.sections.map((s) => (
                <div key={s.title}>
                  <strong style={{ fontSize: 13 }}>{s.title}</strong>
                  <Md className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                    {s.body}
                  </Md>
                </div>
              ))}
              {narrativeReport.risks.length > 0 && (
                <div>
                  <strong style={{ fontSize: 13, color: "var(--warning, #d97706)" }}>
                    Risks & flags
                  </strong>
                  <ul style={{ marginTop: 4, paddingLeft: 20 }}>
                    {narrativeReport.risks.map((r, i) => (
                      <li key={i} style={{ fontSize: 13 }}>
                        <Md>{r}</Md>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p style={{ fontSize: 11, color: "var(--muted)" }}>
                Generated by {narrativeReport.provider}
              </p>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function VarianceView({
  rows,
  left,
  right,
  departmentHierarchy,
  accountHierarchy,
}: {
  rows: VarianceRow[];
  left: string;
  right: string;
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
}) {
  const insights = buildVarianceInsights(rows);
  return (
    <Panel className="span-two">
      <div className="panel-heading">
        <h2>Variance analysis</h2>
        <span>
          {left} vs {right}
        </span>
      </div>
      <div className="variance-insights">
        <VarianceInsightCard title="Largest favorable change" insight={insights.favorable} />
        <VarianceInsightCard title="Largest unfavorable change" insight={insights.unfavorable} />
      </div>
      <VarianceGrid
        rows={rows}
        departmentHierarchy={departmentHierarchy}
        accountHierarchy={accountHierarchy}
      />
    </Panel>
  );
}

function VarianceInsightCard({ title, insight }: { title: string; insight?: VarianceInsight }) {
  return (
    <div className="variance-insight">
      <span>{title}</span>
      <strong>{insight ? describeVarianceInsight(insight) : "No material change"}</strong>
      {insight ? (
        <small>
          {insight.department} · {insight.month}
        </small>
      ) : null}
    </div>
  );
}

function VarianceGrid({
  rows,
  departmentHierarchy,
  accountHierarchy,
}: {
  rows: VarianceRow[];
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
}) {
  const [granularity, setGranularity] = useState<Granularity>("month");
  const months = getMonths(rows);
  const rawPivotRows = pivotVarianceRows(rows, departmentHierarchy, accountHierarchy);
  if (rawPivotRows.length === 0) {
    return <EmptyState title="No variance rows" body="Select scenarios with forecast values." />;
  }
  const { rows: pivotRows, periods } =
    granularity === "quarter"
      ? collapsePivotVarianceRowsToQuarters(rawPivotRows, months)
      : collapsePivotVarianceRowsToMonthsWithYearTotal(rawPivotRows, months);
  return (
    <>
      <div className="grid-toolbar" style={{ justifyContent: "space-between" }}>
        <div className="tab-bar">
          <button
            type="button"
            className={granularity === "month" ? "active" : ""}
            onClick={() => setGranularity("month")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={granularity === "quarter" ? "active" : ""}
            onClick={() => setGranularity("quarter")}
          >
            Quarterly
          </button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <GhostButton
            type="button"
            aria-label="Copy grid"
            onClick={() => copyGrid(buildVarianceGridTsv(periods, pivotRows))}
          >
            <Copy size={15} /> Copy grid
          </GhostButton>
          <ExportMenu
            onCsv={() => {
              const m = buildVarianceGridMatrix(periods, pivotRows);
              exportCsv("variance.csv", m.headers, m.rows);
            }}
            onXlsx={() => {
              const m = buildVarianceGridMatrix(periods, pivotRows);
              void exportXlsx("variance.xlsx", "Variance", m.headers, m.rows);
            }}
            onPdf={() => {
              const m = buildVarianceGridMatrix(periods, pivotRows);
              exportPdf("variance.pdf", "Scenario Variance", m.headers, m.rows);
            }}
          />
        </div>
      </div>
      <div className="spreadsheet-wrap">
        <table className="spreadsheet-grid">
          <thead>
            <tr>
              <th>Department</th>
              <th>Account</th>
              {periods.map((period) => (
                <th key={period} className={isFYPeriod(period) ? "fy-total-col" : undefined}>
                  {period}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pivotRows.map((row) => (
              <tr
                key={`${row.department}-${row.account}`}
                className={row.isParent ? "department-rollup-row" : undefined}
              >
                <th scope="row" style={{ paddingLeft: `${8 + row.hierarchyLevel * 16}px` }}>
                  {row.department}
                </th>
                <td>{row.account}</td>
                {periods.map((period) => {
                  const cell = row.values[period];
                  const isFY = isFYPeriod(period);
                  return (
                    <td
                      key={period}
                      className={`numeric-cell${isFY ? " fy-total-col" : ""} ${(cell?.variance ?? 0) >= 0 ? "positive" : "negative"}`}
                    >
                      {formatCell(row.account, cell?.variance ?? 0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Md({
  children,
  className,
  style,
}: {
  children: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={className} style={style}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
