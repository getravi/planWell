import { useMemo, useState } from "react";
import { Copy, FileText } from "lucide-react";
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
  copyGrid,
  describeVarianceInsight,
  getMonths,
  pivotVarianceRows,
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
      />
      <VarianceView
        rows={rows}
        left={left}
        right={right}
        departmentHierarchy={departmentHierarchy}
        accountHierarchy={accountHierarchy}
      />
      {(report || narrativeError) && (
        <NarrativePanel report={report} error={narrativeError} left={left} right={right} />
      )}
    </div>
  );
}

function ScenarioComparison({
  rows,
  left,
  right,
  onGenerateNarrative,
  narrativeLoading,
}: {
  rows: VarianceRow[];
  left: string;
  right: string;
  onGenerateNarrative: () => void;
  narrativeLoading: boolean;
}) {
  const chartRows = useMemo(() => aggregateVarianceByMonth(rows, "Revenue"), [rows]);
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
      <div style={{ marginTop: 12 }}>
        <GhostButton type="button" onClick={onGenerateNarrative} disabled={narrativeLoading}>
          <FileText size={15} /> {narrativeLoading ? "Generating…" : "Generate narrative"}
        </GhostButton>
      </div>
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
  const months = getMonths(rows);
  const pivotRows = pivotVarianceRows(rows, departmentHierarchy, accountHierarchy);
  if (pivotRows.length === 0) {
    return <EmptyState title="No variance rows" body="Select scenarios with forecast values." />;
  }
  return (
    <>
      <div className="grid-toolbar">
        <GhostButton
          type="button"
          aria-label="Copy grid"
          onClick={() => copyGrid(buildVarianceGridTsv(months, pivotRows))}
        >
          <Copy size={15} /> Copy grid
        </GhostButton>
        <ExportMenu
          onCsv={() => { const m = buildVarianceGridMatrix(months, pivotRows); exportCsv("variance.csv", m.headers, m.rows); }}
          onXlsx={() => { const m = buildVarianceGridMatrix(months, pivotRows); void exportXlsx("variance.xlsx", "Variance", m.headers, m.rows); }}
          onPdf={() => { const m = buildVarianceGridMatrix(months, pivotRows); exportPdf("variance.pdf", "Scenario Variance", m.headers, m.rows); }}
        />
      </div>
      <div className="spreadsheet-wrap">
      <table className="spreadsheet-grid">
        <thead>
          <tr>
            <th>Department</th>
            <th>Account</th>
            {months.map((month) => (
              <th key={month}>{month}</th>
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
              {months.map((month) => {
                const cell = row.values[month];
                return (
                  <td
                    key={month}
                    className={`numeric-cell ${(cell?.variance ?? 0) >= 0 ? "positive" : "negative"}`}
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

function NarrativePanel({
  report,
  error,
  left,
  right,
}: {
  report: NarrativeReport | null;
  error: string;
  left: string;
  right: string;
}) {
  return (
    <Panel className="span-two">
      <div className="panel-heading">
        <h2>Executive narrative</h2>
        <span>{left} vs {right}</span>
      </div>
      {error && <p className="error">{error}</p>}
      {report && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }}>
          <p style={{ fontWeight: 600, fontSize: 15 }}>{report.headline}</p>
          {report.sections.map((s) => (
            <div key={s.title}>
              <strong style={{ fontSize: 13 }}>{s.title}</strong>
              <p className="muted" style={{ marginTop: 4 }}>{s.body}</p>
            </div>
          ))}
          {report.risks.length > 0 && (
            <div>
              <strong style={{ fontSize: 13, color: "var(--warning, #d97706)" }}>Risks & flags</strong>
              <ul style={{ marginTop: 4, paddingLeft: 20 }}>
                {report.risks.map((r, i) => <li key={i} className="muted" style={{ fontSize: 13 }}>{r}</li>)}
              </ul>
            </div>
          )}
          <p style={{ fontSize: 11, color: "var(--muted)" }}>Generated by {report.provider}</p>
        </div>
      )}
    </Panel>
  );
}
