import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { client, type MetricSummary } from "../api.ts";
import type { ActualRow } from "../../domain/types.ts";
import { aggregateByMonth } from "../pivot.ts";
import { compactCurrency, currency } from "../format.ts";
import { EmptyState, Input, Panel } from "../ui.tsx";

export function ActualsPage({
  actuals,
  summary,
}: {
  actuals: ActualRow[];
  summary?: MetricSummary;
}) {
  return (
    <div className="grid two">
      <ImportPanel />
      <Panel>
        <div className="panel-heading">
          <h2>Department cost breakdown</h2>
          <span>{summary?.months.length ?? 0} months imported</span>
        </div>
        {summary?.departments.length ? (
          <CostBreakdown departments={summary.departments} />
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
          <span>12 month actuals</span>
        </div>
        <RevenueChart rows={actuals} />
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

export function RevenueChart({ rows }: { rows: ActualRow[] }) {
  const data = aggregateByMonth(rows, "Revenue");
  if (data.length === 0) {
    return (
      <EmptyState
        title="No revenue data"
        body="Import actuals or select a scenario with forecast values."
      />
    );
  }
  return (
    <ResponsiveContainer height={280}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="revenue-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="#166534" stopOpacity={0.24} />
            <stop offset="95%" stopColor="#166534" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" />
        <YAxis tickFormatter={(value) => compactCurrency(Number(value))} />
        <Tooltip formatter={(value) => currency(Number(value))} />
        <Area dataKey="value" stroke="#166534" fill="url(#revenue-fill)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
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
