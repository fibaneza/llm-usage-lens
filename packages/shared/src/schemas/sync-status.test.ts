import { describe, expect, it } from "vitest";

import { SyncStatusSchema } from "./sync-status";

const VALID_SYNC_STATUS = {
  lastRunAt: "2026-05-15T13:00:00.000Z",
  nextScheduledAt: "2026-05-15T14:00:00.000Z",
  status: "success",
  accountsTotal: 12,
  accountsSuccess: 12,
  accountsFailed: 0,
  errors: [],
  durationMs: 45210,
};

describe("SyncStatusSchema", () => {
  it("accepts a successful run", () => {
    expect(SyncStatusSchema.safeParse(VALID_SYNC_STATUS).success).toBe(true);
  });

  it("accepts a partial run with error entries", () => {
    expect(
      SyncStatusSchema.safeParse({
        ...VALID_SYNC_STATUS,
        status: "partial",
        accountsSuccess: 11,
        accountsFailed: 1,
        errors: [
          {
            accountId: "000000000000",
            message: "AccessDenied on ce:GetCostAndUsage",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it.each(["success", "partial", "error"])("accepts status %j", (status) => {
    expect(
      SyncStatusSchema.safeParse({ ...VALID_SYNC_STATUS, status }).success,
    ).toBe(true);
  });

  it.each([
    ["status", "running"],
    ["lastRunAt", "yesterday"],
    ["nextScheduledAt", 1747314000000],
    ["accountsTotal", -1],
    ["accountsSuccess", 1.5],
    ["durationMs", "fast"],
    ["errors", [{ accountId: "", message: "boom" }]],
    ["errors", [{ message: "missing accountId" }]],
    ["errors", "AccessDenied"], // must be a list, not a bare string
  ])("rejects invalid %s %j", (field, value) => {
    expect(
      SyncStatusSchema.safeParse({ ...VALID_SYNC_STATUS, [field]: value })
        .success,
    ).toBe(false);
  });

  it.each([
    "lastRunAt",
    "nextScheduledAt",
    "status",
    "accountsTotal",
    "errors",
    "durationMs",
  ])("rejects a missing required field %s", (field) => {
    const incomplete: Record<string, unknown> = { ...VALID_SYNC_STATUS };
    delete incomplete[field];
    expect(SyncStatusSchema.safeParse(incomplete).success).toBe(false);
  });
});
