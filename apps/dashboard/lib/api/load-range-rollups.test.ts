import type { DatedDailyRollup } from "@llm-usage-lens/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Pass-through by default; the RF1 cases switch the in-memory fake cache on.
const cacheMode = vi.hoisted(() => ({ fake: false }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return {
    ...mod.passThroughNextCache,
    unstable_cache: (fn: never, keyParts?: string[], options?: object) => {
      const cached = mod.fakeNextCache.unstable_cache(
        fn,
        keyParts,
        options,
      ) as (...a: unknown[]) => Promise<unknown>;
      const direct = fn as (...a: unknown[]) => Promise<unknown>;
      return (...a: unknown[]) =>
        cacheMode.fake ? cached(...a) : direct(...a);
    },
  };
});
const getRollupsByDate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data/daily-rollups", () => ({ getRollupsByDate }));
// The sync status is read through getSyncStatusCached (Design System - Caching
// Strategy, PERF-R); mocked so each case picks the last run.
const getSyncStatusCached = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/cached-reads", () => ({ getSyncStatusCached }));

import { loadRangeRollups, utcDaysInRange } from "@/lib/api/load-range-rollups";
import { resetFakeCache } from "@/test/fakes/next-cache-fake";
import { buildRollup } from "@/test/fixtures/rollup-builder";

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
  getSyncStatusCached.mockReset();
  getSyncStatusCached.mockResolvedValue({ state: "never-synced" });
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

// Design System - Caching Strategy, "Server ... key includes the last sync
// run" (PERF-R, unit RF1, T-RF5): a new run is a new key, the same run is
// served from the cache; "never-synced" is a valid key.
describe("loadRangeRollups cache key (RF1, T-RF5)", () => {
  const synced = (lastRunAt: string) => ({
    state: "synced",
    status: { lastRunAt },
  });
  const load = () => loadRangeRollups("2026-10-01", "2026-10-03");

  beforeEach(() => {
    cacheMode.fake = true;
    resetFakeCache();
    getRollupsByDate.mockReset();
    getRollupsByDate.mockImplementation(async (date: string) => [
      buildRollup({ date, accountId: acct(1) }),
    ]);
  });
  afterEach(() => {
    cacheMode.fake = false;
  });

  it("T-RF5: the same last run is served from the cache (one read per day)", async () => {
    getSyncStatusCached.mockResolvedValue(synced("2026-10-03T12:00:00.000Z"));
    await load();
    await load();
    expect(getRollupsByDate).toHaveBeenCalledTimes(3);
  });

  it("T-RF5: a new last run reads each day once more", async () => {
    getSyncStatusCached.mockResolvedValue(synced("2026-10-03T12:00:00.000Z"));
    await load();
    getSyncStatusCached.mockResolvedValue(synced("2026-10-03T13:00:00.000Z"));
    await load();
    await load();
    expect(getRollupsByDate).toHaveBeenCalledTimes(6);
  });

  it("T-RF5: never-synced is a valid key (cached, then a first run re-reads)", async () => {
    getSyncStatusCached.mockResolvedValue({ state: "never-synced" });
    await load();
    await load();
    expect(getRollupsByDate).toHaveBeenCalledTimes(3);
    getSyncStatusCached.mockResolvedValue(synced("2026-10-03T12:00:00.000Z"));
    await load();
    expect(getRollupsByDate).toHaveBeenCalledTimes(6);
  });
});
