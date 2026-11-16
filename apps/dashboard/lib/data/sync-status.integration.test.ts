import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getSyncStatus } from "@/lib/data/sync-status";

import {
  clearTable,
  ensureTestTable,
  putRaw,
} from "@/test/support/test-support";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: SyncStatus";
// Rule 20.9 (missing item = never synced, not an error); Rule 60.17.
const STATUS = {
  lastRunAt: "2026-10-23T12:00:00.000Z",
  nextScheduledAt: "2026-10-23T13:00:00.000Z",
  status: "partial" as const,
  accountsTotal: 5,
  accountsSuccess: 4,
  accountsFailed: 1,
  errors: [{ accountId: "000000000000", message: "AccessDenied" }],
  durationMs: 4200,
};

beforeAll(ensureTestTable);
beforeEach(clearTable);

describe("getSyncStatus", () => {
  it("returns the never-synced state when no item exists", async () => {
    await expect(getSyncStatus()).resolves.toEqual({ state: "never-synced" });
  });

  it("returns the parsed status without key attributes when present", async () => {
    await putRaw({ PK: "SYSTEM", SK: "SYNC#LATEST", ...STATUS });
    await expect(getSyncStatus()).resolves.toEqual({
      state: "synced",
      status: STATUS,
    });
  });

  it("rejects (does not report never-synced) when the item is malformed", async () => {
    await putRaw({
      PK: "SYSTEM",
      SK: "SYNC#LATEST",
      lastRunAt: "not-a-date",
    });
    await expect(getSyncStatus()).rejects.toThrow();
  });
});
