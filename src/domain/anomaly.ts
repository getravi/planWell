import type { ActualRow } from "./types.ts";

export type AnomalyFlag = {
  month: string;
  department: string;
  account: string;
  value: number;
  expected: number;
  zScore: number;
  reason: string;
};

export function detectAnomalies(actuals: ActualRow[], zThreshold = 2, momThreshold = 0.25): AnomalyFlag[] {
  // Group by (department, account)
  const groups = new Map<string, { month: string; value: number }[]>();
  for (const row of actuals) {
    const key = `${row.department}|${row.account}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push({ month: row.month, value: row.value });
    } else {
      groups.set(key, [{ month: row.month, value: row.value }]);
    }
  }

  const flags: AnomalyFlag[] = [];

  for (const [key, points] of groups) {
    if (points.length < 3) continue; // need enough history
    const [department, account] = key.split("|") as [string, string];
    const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month));

    // Compute mean and stddev
    const values = sorted.map((p) => p.value);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);

    for (let i = 0; i < sorted.length; i++) {
      const { month, value } = sorted[i]!;
      const reasons: string[] = [];
      let maxZScore = 0;

      // Z-score check
      if (stddev > 0) {
        const z = Math.abs(value - mean) / stddev;
        if (z >= zThreshold) {
          maxZScore = z;
          reasons.push(`Z-score ${z.toFixed(1)} (mean ${mean.toFixed(0)}, σ ${stddev.toFixed(0)})`);
        }
      }

      // Month-over-month spike check
      if (i > 0) {
        const prev = sorted[i - 1]!.value;
        if (prev !== 0) {
          const mom = Math.abs(value - prev) / Math.abs(prev);
          if (mom >= momThreshold) {
            if (maxZScore === 0) maxZScore = 0.01; // ensure it gets included
            reasons.push(`${(mom * 100).toFixed(0)}% MoM change from ${prev.toFixed(0)}`);
          }
        }
      }

      if (reasons.length > 0) {
        flags.push({
          month,
          department,
          account,
          value,
          expected: mean,
          zScore: maxZScore,
          reason: reasons.join("; "),
        });
      }
    }
  }

  return flags.sort((a, b) => b.zScore - a.zScore);
}
