import type { DatedDailyRollup } from "@llm-usage-lens/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});
const getRollupsByDate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data/daily-rollups", () => ({ getRollupsByDate }));

import { loadRangeRollups, utcDaysInRange } from "@/lib/api/load-range-rollups";
import { buildRollup } from "@/test/rollup-builder";

const acct = (n: number) => String(n).padStart(12, "0");

// Source: docs/specs/2026-05-15-data-model.md — "API Routes" (ranges are read
// per day via GSI1, capped at 90 days; Rule 20.7/20.8). Contract: a 90-day range never has more than
// MAX_CONCURRENT_DAY_READS (10) getRollupsByDate calls in flight, yet reads
// are still parallel (>1) and results stay in ascending day order.
const MAX_CONCURRENT_DAY_READS = 10;
const settle = () => new Promise<void>((r) => setImmediate(r));

let inFlight = 0;
let peak = 0;
let pending: (() => void)[] = [];

beforeEach(() => {
  inFlight = 0;
  peak = 0;
  pending = [];
  getRollupsByDate.mockReset();
  getRollupsByDate.mockImplementation(
    (date: string) =>
      new Promise<DatedDailyRollup[]>((resolve) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        pending.push(() => {
          inFlight -= 1;
          resolve([
            buildRollup({ date, accountId: acct(1) }),
            buildRollup({ date, accountId: acct(2) }),
          ]);
        });
      }),
  );
});

async function drive<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  while (!done) {
    await settle();
    const batch = pending.splice(0);
    // Release in reverse order: output order must not depend on completion order.
    batch.reverse().forEach((release) => release());
  }
  return tracked;
}

describe("loadRangeRollups concurrency", () => {
  it("never has more than the bound of day reads in flight over 90 days", async () => {
    const days = utcDaysInRange("2026-07-01", "2026-09-28");
    expect(days).toHaveLength(90);
    await drive(loadRangeRollups("2026-07-01", "2026-09-28"));
    expect(getRollupsByDate).toHaveBeenCalledTimes(90);
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_DAY_READS);
    expect(peak).toBeGreaterThan(1);
  });

  it("returns every day's rollups in ascending day order", async () => {
    const result = await drive(loadRangeRollups("2026-07-01", "2026-09-28"));
    const days = utcDaysInRange("2026-07-01", "2026-09-28");
    expect(result).toHaveLength(180);
    expect(result.map((r) => r.date)).toEqual(days.flatMap((d) => [d, d]));
  });

  it("still filters by accountId", async () => {
    const result = await drive(
      loadRangeRollups("2026-10-01", "2026-10-03", acct(2)),
    );
    expect(result).toHaveLength(3);
    expect(new Set(result.map((r) => r.accountId))).toEqual(new Set([acct(2)]));
  });

  it("rejects when a day read fails (no partial result)", async () => {
    getRollupsByDate.mockReset();
    getRollupsByDate.mockRejectedValue(new Error("ddb down"));
    await expect(loadRangeRollups("2026-10-01", "2026-10-03")).rejects.toThrow(
      "ddb down",
    );
  });
});
