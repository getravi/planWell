import { useQuery } from "@tanstack/react-query";
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
  collapsePivotActualRowsToQuarters,
  copyGrid,
  getMonths,
  isFYPeriod,
  pivotActualRows,
  summarizeRows,
  type Granularity,
} from "../pivot.ts";
import { compactCurrency, currency, formatCell } from "../format.ts";
import { EmptyState, ExportMenu, GhostButton, Panel } from "../ui.tsx";
import { exportCsv, exportPdf, exportXlsx } from "../export.ts";

export function ActualsPage({
  actuals,
  departmentHierarchy,
  accountHierarchy,
  granularity,
}: {
  actuals: ActualRow[];
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
  granularity: Granularity;
}) {
  const filteredSummary = summarizeRows(actuals);
  const anomalyQuery = useQuery({ queryKey: ["anomalies"], queryFn: client.anomalies });
  const anomalySet = new Set(
    (anomalyQuery.data?.anomalies ?? []).map((f) => `${f.department}|${f.account}|${f.month}`),
  );
  const anomalyMap = new Map(
    (anomalyQuery.data?.anomalies ?? []).map((f) => [`${f.department}|${f.account}|${f.month}`, f]),
  );

  return (
    <div className="grid two">
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
      <Panel>
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
              {anomalyQuery.data!.anomalies.length} anomaly
              {anomalyQuery.data!.anomalies.length !== 1 ? "s" : ""} detected
            </span>
          )}
        </div>
        <ActualsGrid
          rows={actuals}
          departmentHierarchy={departmentHierarchy}
          accountHierarchy={accountHierarchy}
          anomalySet={anomalySet}
          anomalyMap={anomalyMap}
          granularity={granularity}
        />
      </Panel>
    </div>
  );
}

function ActualsGrid({
  rows,
  departmentHierarchy,
  accountHierarchy,
  anomalySet,
  anomalyMap,
  granularity,
}: {
  rows: ActualRow[];
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
  anomalySet: Set<string>;
  anomalyMap: Map<string, AnomalyFlag>;
  granularity: Granularity;
}) {
  const months = getMonths(rows);
  const rawPivotRows = pivotActualRows(rows, departmentHierarchy, accountHierarchy);
  if (rawPivotRows.length === 0) {
    return <EmptyState title="No actuals" body="Import actuals to populate the table." />;
  }
  const { rows: pivotRows, periods } =
    granularity === "quarter"
      ? collapsePivotActualRowsToQuarters(rawPivotRows, months)
      : { rows: rawPivotRows, periods: months };
  return (
    <>
      <div className="grid-toolbar">
        <GhostButton
          type="button"
          aria-label="Copy grid"
          onClick={() => copyGrid(buildActualGridTsv(periods, pivotRows))}
        >
          <Copy size={15} /> Copy grid
        </GhostButton>
        <ExportMenu
          onCsv={() => {
            const m = buildActualGridMatrix(periods, pivotRows);
            exportCsv("actuals.csv", m.headers, m.rows);
          }}
          onXlsx={() => {
            const m = buildActualGridMatrix(periods, pivotRows);
            void exportXlsx("actuals.xlsx", "Actuals", m.headers, m.rows);
          }}
          onPdf={() => {
            const m = buildActualGridMatrix(periods, pivotRows);
            exportPdf("actuals.pdf", "Actuals", m.headers, m.rows);
          }}
        />
      </div>
      <div className="spreadsheet-wrap">
        <table className="spreadsheet-grid">
          <thead>
            <tr>
              <th>Department</th>
              <th>Account</th>
              {periods.map((period) => (
                <th key={period} className={isFYPeriod(period) ? "fy-total-col" : undefined}>{period}</th>
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
                  const cellKey = `${row.department}|${row.account}|${period}`;
                  const isAnomaly = granularity === "month" && anomalySet.has(cellKey);
                  const flag = granularity === "month" ? anomalyMap.get(cellKey) : undefined;
                  const isFY = isFYPeriod(period);
                  return (
                    <td
                      key={period}
                      className={`numeric-cell${isFY ? " fy-total-col" : ""}`}
                      style={isAnomaly ? { background: "rgba(217,119,6,0.08)" } : undefined}
                      title={flag ? `Anomaly: ${flag.reason}` : undefined}
                    >
                      {formatCell(row.account, row.values[period] ?? 0)}
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
