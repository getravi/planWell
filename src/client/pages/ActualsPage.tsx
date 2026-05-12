import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Copy } from "lucide-react";
import { client, type AnomalyFlag, type MetricSummary } from "../api.ts";
import type { ActualRow, DimensionMember } from "../../domain/types.ts";
import { RevenueChart } from "../components/RevenueChart.tsx";
import {
  buildActualGridMatrix,
  buildActualGridTsv,
  copyGrid,
  getMonths,
  pivotActualRows,
  summarizeRows,
} from "../pivot.ts";
import { compactCurrency, currency, formatCell } from "../format.ts";
import { EmptyState, ExportMenu, GhostButton, Input, Panel } from "../ui.tsx";
import { exportCsv, exportPdf, exportXlsx } from "../export.ts";

export function ActualsPage({
  actuals,
  departmentHierarchy,
  accountHierarchy,
}: {
  actuals: ActualRow[];
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
}) {
  const filteredSummary = summarizeRows(actuals);
  const anomalyQuery = useQuery({ queryKey: ["anomalies"], queryFn: client.anomalies });
  const anomalySet = new Set(
    (anomalyQuery.data?.anomalies ?? []).map((f) => `${f.department}|${f.account}|${f.month}`)
  );
  const anomalyMap = new Map(
    (anomalyQuery.data?.anomalies ?? []).map((f) => [`${f.department}|${f.account}|${f.month}`, f])
  );

  return (
    <div className="grid two">
      <ImportPanel />
      <Panel>
        <div className="panel-heading">
          <h2>Department cost breakdown</h2>
          <span>{filteredSummary.months.length} months</span>
        </div>
        {filteredSummary.departments.length ? (
          <CostBreakdown departments={filteredSummary.departments} />
        ) : (
          <EmptyState
            title="No actuals imported"
            body="Download a sample CSV or upload your own actuals to populate the cube."
          />
        )}
      </Panel>
      <Panel className="span-two">
        <div className="panel-heading">
          <h2>Historical revenue</h2>
        </div>
        <RevenueChart rows={actuals} />
      </Panel>
      <Panel className="span-two">
        <div className="panel-heading">
          <h2>Actuals by department and account</h2>
          {(anomalyQuery.data?.anomalies?.length ?? 0) > 0 && (
            <span style={{ color: "var(--warning, #d97706)", fontSize: 13 }}>
              {anomalyQuery.data!.anomalies.length} anomaly{anomalyQuery.data!.anomalies.length !== 1 ? "s" : ""} detected
            </span>
          )}
        </div>
        <ActualsGrid
          rows={actuals}
          departmentHierarchy={departmentHierarchy}
          accountHierarchy={accountHierarchy}
          anomalySet={anomalySet}
          anomalyMap={anomalyMap}
        />
      </Panel>
    </div>
  );
}

function ImportPanel() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const importCsv = useMutation({
    mutationFn: client.importCsv,
    onSuccess: async (result) => {
      setStatus(
        `Imported ${result.diagnostics.rowsImported} rows from ${result.diagnostics.shape} CSV.`,
      );
      await queryClient.invalidateQueries();
    },
  });
  return (
    <Panel>
      <div className="panel-heading">
        <h2>Import actuals</h2>
        <FileUp size={18} />
      </div>
      <p className="muted">
        Upload long or wide CSV actuals. Data is normalized into month, department, account, and
        value.
      </p>
      <div className="sample-links">
        <a href="/api/sample-csvs/long">Long sample</a>
        <a href="/api/sample-csvs/wide">Wide sample</a>
      </div>
      <Input
        type="file"
        accept=".csv,text/csv"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) {
            return;
          }
          importCsv.mutate(await file.text());
        }}
      />
      {status ? <p className="success">{status}</p> : null}
      {importCsv.error ? <p className="error">{importCsv.error.message}</p> : null}
    </Panel>
  );
}

function ActualsGrid({
  rows,
  departmentHierarchy,
  accountHierarchy,
  anomalySet,
  anomalyMap,
}: {
  rows: ActualRow[];
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
  anomalySet: Set<string>;
  anomalyMap: Map<string, AnomalyFlag>;
}) {
  const months = getMonths(rows);
  const pivotRows = pivotActualRows(rows, departmentHierarchy, accountHierarchy);
  if (pivotRows.length === 0) {
    return <EmptyState title="No actuals" body="Import actuals to populate the table." />;
  }
  return (
    <>
      <div className="grid-toolbar">
        <GhostButton
          type="button"
          aria-label="Copy grid"
          onClick={() => copyGrid(buildActualGridTsv(months, pivotRows))}
        >
          <Copy size={15} /> Copy grid
        </GhostButton>
        <ExportMenu
          onCsv={() => { const m = buildActualGridMatrix(months, pivotRows); exportCsv("actuals.csv", m.headers, m.rows); }}
          onXlsx={() => { const m = buildActualGridMatrix(months, pivotRows); void exportXlsx("actuals.xlsx", "Actuals", m.headers, m.rows); }}
          onPdf={() => { const m = buildActualGridMatrix(months, pivotRows); exportPdf("actuals.pdf", "Actuals", m.headers, m.rows); }}
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
                const cellKey = `${row.department}|${row.account}|${month}`;
                const isAnomaly = anomalySet.has(cellKey);
                const flag = anomalyMap.get(cellKey);
                return (
                  <td
                    key={month}
                    className="numeric-cell"
                    style={isAnomaly ? { background: "rgba(217,119,6,0.08)" } : undefined}
                    title={flag ? `Anomaly: ${flag.reason}` : undefined}
                  >
                    {formatCell(row.account, row.values[month] ?? 0)}
                    {isAnomaly && (
                      <span
                        style={{
                          display: "inline-block",
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "#d97706",
                          marginLeft: 4,
                          verticalAlign: "middle",
                          flexShrink: 0,
                        }}
                        aria-label="anomaly"
                      />
                    )}
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

function CostBreakdown({ departments }: { departments: MetricSummary["departments"] }) {
  return (
    <ResponsiveContainer height={280}>
      <BarChart data={departments}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="department" />
        <YAxis tickFormatter={(value) => compactCurrency(Number(value))} />
        <Tooltip formatter={(value) => currency(Number(value))} />
        <Legend />
        <Bar dataKey="cogs" name="COGS" fill="#0f766e" />
        <Bar dataKey="opex" name="OpEx" fill="#334155" />
      </BarChart>
    </ResponsiveContainer>
  );
}
