import { describe, expect, it } from "vitest";

import { DailyRollupItemSchema } from "../index";

// Source: docs/specs/2026-05-15-data-model.md — "`date` attribute (audit A2;
// adopted 2026-10-28)": the write-side DailyRollupItemSchema is the full
// DynamoDB item (rollup + key attributes PK/SK/gsi1pk/gsi1sk, as written by
// scripts/lib/seed-writer.ts) with a REQUIRED `date` that must match the day
// in SK (DAILY#…) and gsi1pk (DATE#…). Cost invariant: "Non-Model Charges".
// implementation-phases "Phase 3.1a" Verify: rejects a date <-> SK/gsi1pk mismatch.

const ATTRIBUTION_ENTRY = {
  cost: 0.5,
  costEstimated: true,
  inputTokens: 1000,
  outputTokens: 500,
  invocations: 2,
};

const DAY = "2026-10-27";

const VALID_ITEM = {
  PK: "ACCT#000000000000",
  SK: `DAILY#${DAY}`,
  gsi1pk: `DATE#${DAY}`,
  gsi1sk: "ACCT#000000000000",
  date: DAY,
  accountId: "000000000000",
  departmentId: "dept-engineering",
  departmentName: "Engineering",
  teamId: "team-payments",
  teamName: "Payments",
  cost: 10.5,
  costFinalized: true,
  inputTokens: 1000,
  outputTokens: 500,
  invocations: 2,
  models: {
    "claude-sonnet": {
      cost: 10,
      costEstimated: false,
      inputTokens: 1000,
      outputTokens: 500,
      invocations: 2,
      byUser: { "john.doe@company.com": ATTRIBUTION_ENTRY },
      byService: { _untagged: ATTRIBUTION_ENTRY },
    },
  },
  nonModel: {
    guardrails: {
      cost: 0.5,
      costEstimated: false,
      recurring: false,
      rawUsageTypes: ["USE1-Guardrail-ContentPolicy-Units"],
    },
  },
  lastUpdatedAt: `${DAY}T23:59:59.000Z`,
  expiresAt: 1_900_000_000,
};

function without(field: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...VALID_ITEM };
  delete copy[field];
  return copy;
}

describe("DailyRollupItemSchema", () => {
  it("accepts an item whose date matches SK and gsi1pk, and preserves date", () => {
    const result = DailyRollupItemSchema.safeParse(VALID_ITEM);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.date).toBe(DAY);
  });

  it("rejects an item without date (required on the write side)", () => {
    expect(DailyRollupItemSchema.safeParse(without("date")).success).toBe(
      false,
    );
  });

  it("rejects a date that differs from the day in SK", () => {
    expect(
      DailyRollupItemSchema.safeParse({ ...VALID_ITEM, SK: "DAILY#2026-10-26" })
        .success,
    ).toBe(false);
  });

  it("rejects a date that differs from the day in gsi1pk", () => {
    expect(
      DailyRollupItemSchema.safeParse({
        ...VALID_ITEM,
        gsi1pk: "DATE#2026-10-26",
      }).success,
    ).toBe(false);
  });

  it("rejects when SK and gsi1pk agree with each other but not with date", () => {
    expect(
      DailyRollupItemSchema.safeParse({
        ...VALID_ITEM,
        SK: "DAILY#2026-10-26",
        gsi1pk: "DATE#2026-10-26",
      }).success,
    ).toBe(false);
  });

  it.each(["SK", "gsi1pk"])(
    "rejects an item missing the %s key attribute",
    (field) => {
      expect(DailyRollupItemSchema.safeParse(without(field)).success).toBe(
        false,
      );
    },
  );

  it.each([["2026-13-01"], ["2026/10/27"], ["20261027"], [20261027]])(
    "rejects a malformed date %j",
    (date) => {
      expect(
        DailyRollupItemSchema.safeParse({ ...VALID_ITEM, date }).success,
      ).toBe(false);
    },
  );

  it("still enforces the cost invariant (cost = Σ models + Σ nonModel)", () => {
    expect(
      DailyRollupItemSchema.safeParse({ ...VALID_ITEM, cost: 99 }).success,
    ).toBe(false);
    // Model sum only (omits the nonModel term) is also a violation.
    expect(
      DailyRollupItemSchema.safeParse({ ...VALID_ITEM, cost: 10 }).success,
    ).toBe(false);
  });
});

// Source: data-model spec — "TTL attribute `expiresAt`" (2026-11-17): REQUIRED,
// positive integer epoch seconds on the write side; the legacy `ttl` is not written.
describe("DailyRollupItemSchema expiresAt (data-model — TTL attribute expiresAt)", () => {
  it("rejects an item without expiresAt", () => {
    expect(DailyRollupItemSchema.safeParse(without("expiresAt")).success).toBe(
      false,
    );
  });

  it("rejects a legacy item that has ttl but no expiresAt", () => {
    expect(
      DailyRollupItemSchema.safeParse({
        ...without("expiresAt"),
        ttl: 1_900_000_000,
      }).success,
    ).toBe(false);
  });

  it.each([0, -1, 1.5, "1900000000"])("rejects expiresAt %j", (value) => {
    expect(
      DailyRollupItemSchema.safeParse({ ...VALID_ITEM, expiresAt: value })
        .success,
    ).toBe(false);
  });

  it("keeps expiresAt and drops ttl in the parsed item", () => {
    const result = DailyRollupItemSchema.safeParse({ ...VALID_ITEM, ttl: 5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresAt).toBe(1_900_000_000);
      expect("ttl" in result.data).toBe(false);
    }
  });
});
