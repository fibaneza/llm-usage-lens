import "server-only";

import type { DatedDailyRollup } from "@bedrock-usage/shared";

import { getRollupsByDate } from "@/lib/data/daily-rollups";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Inclusive list of UTC calendar days (Rule 20.1).
export function utcDaysInRange(dateFrom: string, dateTo: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${dateTo}T00:00:00Z`);
  for (let t = Date.parse(`${dateFrom}T00:00:00Z`); t <= end; t += MS_PER_DAY) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

// Rankings and aggregates are computed in memory after fetching every day via
// GSI1 (Rule 20.7); the range is already capped at 90 days by the query schema.
export async function loadRangeRollups(
  dateFrom: string,
  dateTo: string,
  accountId?: string,
): Promise<DatedDailyRollup[]> {
  const perDay = await Promise.all(
    utcDaysInRange(dateFrom, dateTo).map(getRollupsByDate),
  );
  const all = perDay.flat();
  return accountId ? all.filter((r) => r.accountId === accountId) : all;
}
