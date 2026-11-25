import {
  SyncStatusResultSchema,
  apiResponseSchema,
} from "@llm-usage-lens/shared";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
// Pass-through by default; the RF1 cases switch the in-memory fake cache on.
const cacheMode = vi.hoisted(() => ({ fake: false }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return {
    ...mod.passThroughNextCache,
    revalidateTag: (tag: string, profile?: unknown) => {
      if (cacheMode.fake) mod.fakeNextCache.revalidateTag(tag, profile);
    },
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
const reads = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/data/sync-status", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/sync-status")>(
    "@/lib/data/sync-status",
  );
  return {
    ...actual,
    getSyncStatus: () => {
      reads.fn();
      return actual.getSyncStatus();
    },
  };
});

import { GET, revalidate } from "@/app/api/sync-status/route";

import { resetFakeCache } from "@/test/fakes/next-cache-fake";
import {
  clearTable,
  ensureTestTable,
  putRaw,
} from "@/test/support/test-support";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes" + "Entity:
// SyncStatus"; Rule 20.9 (missing item = handled "never synced" state, so the
// route returns 200 { data: { state: "never-synced" } } — the existing
// getSyncStatus() SyncStatusResult union, not null and not an error);
// Rule 60.10 (revalidate = 3600); Rule 60.23.
const STATUS = {
  lastRunAt: "2026-10-23T12:00:00.000Z",
  nextScheduledAt: "2026-10-23T13:00:00.000Z",
  status: "success" as const,
  accountsTotal: 2,
  accountsSuccess: 2,
  accountsFailed: 0,
  errors: [],
  durationMs: 1000,
};
const call = () =>
  GET(new Request("http://localhost/api/sync-status"), {
    params: Promise.resolve({}),
  });

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  auth.mockReset();
});

describe("GET /api/sync-status", () => {
  it("exports revalidate = 3600", () => {
    expect(revalidate).toBe(3600);
  });

  it("returns the never-synced state as data (not an error) when no item exists", async () => {
    auth.mockResolvedValue({ user: { oid: "oid-test" } });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { state: "never-synced" } });
  });

  it("returns the synced status, validated by the response schema", async () => {
    auth.mockResolvedValue({ user: { oid: "oid-test" } });
    await putRaw({ PK: "SYSTEM", SK: "SYNC#LATEST", ...STATUS });
    const res = await call();
    expect(res.status).toBe(200);
    const body = apiResponseSchema(SyncStatusResultSchema).parse(
      await res.json(),
    );
    expect(body).toEqual({ data: { state: "synced", status: STATUS } });
  });
});

// Design System - Caching Strategy, Refresh (PERF-R, unit RF1, T-RF3/T-RF4):
// `Cache-Control: no-cache` skips the 5-minute cache and replaces its entry;
// one bypass per key per 10 seconds; the session check stays first.
describe("GET /api/sync-status - refresh bypass (RF1)", () => {
  const T0 = Date.parse("2026-11-25T10:00:00.000Z");
  const signedIn = () => auth.mockResolvedValue({ user: { oid: "oid-test" } });
  const status = (lastRunAt: string) => ({
    PK: "SYSTEM",
    SK: "SYNC#LATEST",
    ...STATUS,
    lastRunAt,
  });
  const lastRun = async (res: Response) =>
    (await res.json()).data.status.lastRunAt as string;
  let route: typeof import("@/app/api/sync-status/route");
  const req = (cacheControl?: string) =>
    route.GET(
      new Request("http://localhost/api/sync-status", {
        headers: cacheControl ? { "Cache-Control": cacheControl } : {},
      }),
      { params: Promise.resolve({}) },
    );

  beforeEach(async () => {
    cacheMode.fake = true;
    resetFakeCache();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    vi.resetModules();
    route = await import("@/app/api/sync-status/route");
    reads.fn.mockClear();
    signedIn();
  });
  afterEach(() => {
    cacheMode.fake = false;
    vi.useRealTimers();
  });

  it("T-RF4: without the header the route serves its cache (one read), private no-store", async () => {
    await putRaw(status("2026-10-23T12:00:00.000Z"));
    const first = await req();
    await putRaw(status("2026-10-23T13:00:00.000Z"));
    const second = await req();
    expect(reads.fn).toHaveBeenCalledTimes(1);
    expect(await lastRun(second)).toBe("2026-10-23T12:00:00.000Z");
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    expect(second.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T-RF4: a Cache-Control without no-cache (max-age=60) is not a bypass", async () => {
    await putRaw(status("2026-10-23T12:00:00.000Z"));
    await req();
    await putRaw(status("2026-10-23T13:00:00.000Z"));
    const res = await req("max-age=60");
    expect(reads.fn).toHaveBeenCalledTimes(1);
    expect(await lastRun(res)).toBe("2026-10-23T12:00:00.000Z");
  });

  it("T-RF3: no-cache skips the cache and replaces the entry; the next ordinary request is fresh without a read; response is private no-store", async () => {
    await putRaw(status("2026-10-23T12:00:00.000Z"));
    await req();
    await putRaw(status("2026-10-23T13:00:00.000Z"));
    const bypass = await req("max-age=0, no-cache");
    expect(reads.fn).toHaveBeenCalledTimes(2);
    expect(await lastRun(bypass)).toBe("2026-10-23T13:00:00.000Z");
    expect(bypass.headers.get("Cache-Control")).toBe("private, no-store");
    const ordinary = await req();
    expect(reads.fn).toHaveBeenCalledTimes(2);
    expect(await lastRun(ordinary)).toBe("2026-10-23T13:00:00.000Z");
  });

  it("T-RF3: a second bypass within 10 seconds gets the entry just read; after 10 seconds it reads again (PERF-R minimum interval)", async () => {
    await putRaw(status("2026-10-23T12:00:00.000Z"));
    await req("no-cache");
    expect(reads.fn).toHaveBeenCalledTimes(1);
    await putRaw(status("2026-10-23T13:00:00.000Z"));
    vi.setSystemTime(T0 + 5_000);
    const limited = await req("no-cache");
    expect(reads.fn).toHaveBeenCalledTimes(1);
    expect(await lastRun(limited)).toBe("2026-10-23T12:00:00.000Z");
    vi.setSystemTime(T0 + 10_001);
    const allowed = await req("no-cache");
    expect(reads.fn).toHaveBeenCalledTimes(2);
    expect(await lastRun(allowed)).toBe("2026-10-23T13:00:00.000Z");
  });

  it("T-RF4: no session with no-cache is 401 before any read and does not use the bypass allowance (Rule 50.4)", async () => {
    await putRaw(status("2026-10-23T12:00:00.000Z"));
    auth.mockResolvedValue(null);
    const res = await req("no-cache");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBeTruthy();
    expect(reads.fn).not.toHaveBeenCalled();
    signedIn();
    const after = await req("no-cache");
    expect(after.status).toBe(200);
    expect(reads.fn).toHaveBeenCalledTimes(1);
  });
});
