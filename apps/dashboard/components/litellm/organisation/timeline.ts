import type { LiteLLMOrgDailyRowSchema } from "@llm-usage-lens/shared";
import type { z } from "zod";

import type { WeekBucket } from "./format";

type TimelineRow = Pick<
  z.infer<typeof LiteLLMOrgDailyRowSchema>,
  "date" | "spend" | "tokens" | "requests"
>;

// Every UTC day from dateFrom to dateTo inclusive (LD20; Rule 20.1).
export function daysOf(dateFrom: string, dateTo: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${dateTo}T00:00:00Z`);
  for (let t = Date.parse(`${dateFrom}T00:00:00Z`); t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

export function valuesOf(
  rows: readonly TimelineRow[],
  metric: "spend" | "tokens" | "requests",
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const row of rows) {
    const value = row[metric];
    if (value !== undefined) values[row.date] = value;
  }
  return values;
}

// Sums each series' days into its week bucket (Design System -- OC2).
export function bucketed(
  values: Record<string, number>,
  buckets: readonly WeekBucket[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const bucket of buckets) {
    for (const day of bucket.days) {
      const value = values[day];
      if (value !== undefined) out[bucket.key] = (out[bucket.key] ?? 0) + value;
    }
  }
  return out;
}
