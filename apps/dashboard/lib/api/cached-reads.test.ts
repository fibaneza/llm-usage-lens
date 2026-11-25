import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const revalidate = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return { ...mod.passThroughNextCache, revalidateTag: revalidate.fn };
});
vi.mock("@/lib/data/account-meta", () => ({
  getAllAccounts: vi.fn(),
  getAccountsByDepartment: vi.fn(),
}));
vi.mock("@/lib/data/sync-status", () => ({ getSyncStatus: vi.fn() }));

// Design System - Caching Strategy, Refresh (PERF-R, unit RF1).
describe("sync-status refresh exports (PERF-R)", () => {
  it("exports the bypass read and its 10-second limit", async () => {
    const mod = await import("@/lib/api/cached-reads");
    expect(mod.SYNC_STATUS_BYPASS_MIN_INTERVAL_MS).toBe(10_000);
    expect(typeof mod.refreshSyncStatusCached).toBe("function");
    expect(typeof mod.getSyncStatusCached).toBe("function");
  });
});

// Design System - Caching Strategy, Refresh (T-RF6): the refresh path never
// calls revalidateTag (any signed-in user could force a 90-day re-read), nor
// revalidatePath. Comments are stripped; the rule names are prose there.
const APP = resolve(import.meta.dirname, "../..");
const REFRESH_PATH_FILES = [
  "components/status/RefreshButton.tsx",
  "app/api/sync-status/route.ts",
  "lib/api/load-range-rollups.ts",
  "lib/query/fetch-api.ts",
];
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (file: string) =>
  stripComments(readFileSync(resolve(APP, file), "utf8"));

// T-RF6 amended 2026-11-25 (Q-W1): the one allowed call is the fixed tag.
describe("refresh path revalidation (T-RF6, amended, Q-W1)", () => {
  it.each(REFRESH_PATH_FILES)(
    "%s neither imports nor calls revalidateTag, revalidatePath or updateTag",
    (file) => {
      expect(read(file)).not.toMatch(/revalidateTag|revalidatePath|updateTag/);
    },
  );

  it("cached-reads.ts never mentions revalidatePath or updateTag", () => {
    expect(read("lib/api/cached-reads.ts")).not.toMatch(
      /revalidatePath|updateTag/,
    );
  });

  it('cached-reads.ts has exactly one revalidateTag call: revalidateTag("sync-status", { expire: 0 })', () => {
    const calls =
      read("lib/api/cached-reads.ts").match(/revalidateTag\s*\([^)]*\)/g) ?? [];
    expect(calls).toEqual(['revalidateTag("sync-status", { expire: 0 })']);
  });
});

// Design System - Caching Strategy, Refresh (T-RF3, Q-W1): an honoured bypass
// expires the fixed sync-status tag once; one per 10 seconds per task.
describe("refreshSyncStatusCached expires the fixed tag (T-RF3, Q-W1)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls revalidateTag once per honoured bypass, not inside 10 seconds, again after", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-25T10:00:00.000Z"));
    vi.resetModules();
    revalidate.fn.mockClear();
    const mod = await import("@/lib/api/cached-reads");

    await mod.refreshSyncStatusCached();
    expect(revalidate.fn).toHaveBeenCalledTimes(1);
    expect(revalidate.fn).toHaveBeenLastCalledWith("sync-status", {
      expire: 0,
    });

    vi.setSystemTime(Date.parse("2026-11-25T10:00:05.000Z"));
    await mod.refreshSyncStatusCached();
    expect(revalidate.fn).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.parse("2026-11-25T10:00:10.001Z"));
    await mod.refreshSyncStatusCached();
    expect(revalidate.fn).toHaveBeenCalledTimes(2);
  });

  it("an ordinary getSyncStatusCached never revalidates", async () => {
    vi.resetModules();
    revalidate.fn.mockClear();
    const mod = await import("@/lib/api/cached-reads");
    await mod.getSyncStatusCached();
    expect(revalidate.fn).not.toHaveBeenCalled();
  });
});
