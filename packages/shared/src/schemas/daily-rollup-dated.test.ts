import { describe, expect, it } from "vitest";

import { DailyRollupBaseSchema, DatedDailyRollupSchema } from "../index";

// Source: docs/specs/2026-05-15-data-model.md — "`date` attribute (audit A2;
// adopted 2026-10-28)": data-access functions return `date` on every rollup.
// DatedDailyRollupSchema = DailyRollupBaseSchema with a REQUIRED `date`, plus
// the "Non-Model Charges" cost invariant; Rule 60.3 (types derive from Zod).

const ENTRY = {
  cost: 0.5,
  costEstimated: true,
  inputTokens: 1000,
  outputTokens: 500,
  invocations: 2,
};

const VALID_DATED = {
  date: "2026-10-27",
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
      byUser: { "john.doe@company.com": ENTRY },
      byService: { _untagged: ENTRY },
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
  lastUpdatedAt: "2026-10-27T23:59:59.000Z",
  expiresAt: 1_900_000_000,
};

describe("DatedDailyRollupSchema", () => {
  it("accepts a rollup with a valid date and preserves it", () => {
    const result = DatedDailyRollupSchema.safeParse(VALID_DATED);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.date).toBe("2026-10-27");
  });

  it("rejects a rollup with no date (required, unlike DailyRollupBaseSchema)", () => {
    const undated: Record<string, unknown> = { ...VALID_DATED };
    delete undated.date;
    expect(DatedDailyRollupSchema.safeParse(undated).success).toBe(false);
    expect(DailyRollupBaseSchema.safeParse(undated).success).toBe(true);
  });

  it.each([
    ["2026-13-01"],
    ["2026-02-31"],
    ["2026/10/27"],
    ["20261027"],
    [20261027],
    [undefined],
    [null],
  ])("rejects an invalid date %j", (date) => {
    expect(
      DatedDailyRollupSchema.safeParse({ ...VALID_DATED, date }).success,
    ).toBe(false);
  });

  it("still enforces the cost invariant (cost = Σ models + Σ nonModel)", () => {
    expect(
      DatedDailyRollupSchema.safeParse({ ...VALID_DATED, cost: 99 }).success,
    ).toBe(false);
    expect(
      DatedDailyRollupSchema.safeParse({ ...VALID_DATED, cost: 10 }).success,
    ).toBe(false);
  });
});

// Source: data-model spec — "TTL attribute `expiresAt`" (2026-11-17).
describe("DatedDailyRollupSchema legacy ttl (data-model — TTL attribute expiresAt)", () => {
  const base = { ...VALID_DATED };
  delete (base as Partial<typeof base>).expiresAt;

  it("accepts a legacy item with ttl and no expiresAt, stripping ttl", () => {
    const result = DatedDailyRollupSchema.safeParse({
      ...base,
      expiresAt: 1_900_000_000,
    });
    expect(result.success).toBe(true);
    if (result.success) expect("ttl" in result.data).toBe(false);
  });
});
