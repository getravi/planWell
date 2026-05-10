import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ActualRow } from "../../domain/types.ts";
import { aggregateByMonth } from "../pivot.ts";
import { compactCurrency, currency } from "../format.ts";
import { EmptyState } from "../ui.tsx";

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
