import {
  SyncStatusResultSchema,
  apiResponseSchema,
} from "@llm-usage-lens/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

import { GET, revalidate } from "@/app/api/sync-status/route";

import { clearTable, ensureTestTable, putRaw } from "@/test/test-support";

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

  it("returns 401 without a session and exposes no data", async () => {
    auth.mockResolvedValue(null);
    await putRaw({ PK: "SYSTEM", SK: "SYNC#LATEST", ...STATUS });
    const res = await call();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.data).toBeUndefined();
  });

  it("returns the never-synced state as data (not an error) when no item exists", async () => {
    auth.mockResolvedValue({ user: {} });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { state: "never-synced" } });
  });

  it("returns the synced status, validated by the response schema", async () => {
    auth.mockResolvedValue({ user: {} });
    await putRaw({ PK: "SYSTEM", SK: "SYNC#LATEST", ...STATUS });
    const res = await call();
    expect(res.status).toBe(200);
    const body = apiResponseSchema(SyncStatusResultSchema).parse(
      await res.json(),
    );
    expect(body).toEqual({ data: { state: "synced", status: STATUS } });
  });
});
