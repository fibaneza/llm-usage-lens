import "server-only";

import { runBounded } from "@bedrock-usage/shared";
import type { DatedDailyRollup } from "@bedrock-usage/shared";
import { unstable_cache } from "next/cache";

import { getRollupsByDate } from "@/lib/data/daily-rollups";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ONE_HOUR_SECONDS = 3600;
// Bounded to avoid GSI throttling on a real table at Rule 20.7 scale.
export const MAX_CONCURRENT_DAY_READS = 10;

// Inclusive list of UTC calendar days (Rule 20.1).
export function utcDaysInRange(dateFrom: string, dateTo: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${dateTo}T00:00:00Z`);
  for (let t = Date.parse(`${dateFrom}T00:00:00Z`); t <= end; t += MS_PER_DAY) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

// Cached per UTC day: a whole-range entry would exceed Next's 2 MB per-entry
// limit at ~100 accounts x 30 days. The day is the only cache key input.
const getRollupsByDateCached = unstable_cache(
  getRollupsByDate,
  ["rollups-by-date"],
  { revalidate: ONE_HOUR_SECONDS, tags: ["rollups"] },
);

// Rankings and aggregates are computed in memory after fetching every day via
// GSI1 (Rule 20.7); the range is already capped at 90 days by the query schema.
// Reads are bounded so a 90-day range cannot flood DynamoDB, and results are
// assembled by day index so order never depends on completion order. Caching
// happens per day; bounding, ordering and the accountId filter stay outside the
// cache so overlapping ranges and accounts reuse day entries.
export async function loadRangeRollups(
  dateFrom: string,
  dateTo: string,
  accountId?: string,
): Promise<DatedDailyRollup[]> {
  const days = utcDaysInRange(dateFrom, dateTo);
  const perDay: DatedDailyRollup[][] = days.map(() => []);
  await runBounded(
    days.map((day, index) => ({ day, index })),
    MAX_CONCURRENT_DAY_READS,
    async ({ day, index }) => {
      perDay[index] = await getRollupsByDateCached(day);
    },
  );
  const all = perDay.flat();
  return accountId ? all.filter((r) => r.accountId === accountId) : all;
}
