import { describe, expect, it } from "vitest";

import {
  AttributionEntrySchema,
  DailyRollupSchema,
  ModelUsageSchema,
} from "./daily-rollup";

const ATTRIBUTION_ENTRY = {
  cost: 0.42,
  costEstimated: true,
  inputTokens: 1000,
  outputTokens: 500,
  invocations: 3,
};

const VALID_ROLLUP = {
  accountId: "000000000000",
  departmentId: "dept-engineering",
  departmentName: "Engineering",
  teamId: "team-payments",
  teamName: "Payments",
  cost: 12.345678,
  costFinalized: false,
  inputTokens: 250000,
  outputTokens: 80000,
  invocations: 120,
  models: {
    "claude-sonnet": {
      cost: 10.5,
      costEstimated: false,
      inputTokens: 200000,
      outputTokens: 60000,
      invocations: 100,
      byUser: { "john.doe@company.com": ATTRIBUTION_ENTRY },
      byService: {
        "payments-api": ATTRIBUTION_ENTRY,
        _untagged: ATTRIBUTION_ENTRY,
      },
    },
    other: {
      cost: 1.845678,
      costEstimated: true,
      inputTokens: 50000,
      outputTokens: 20000,
      invocations: 20,
      rawModelIds: ["amazon.titan-text-express-v1"],
      byUser: {},
      byService: {},
    },
  },
  lastUpdatedAt: "2026-05-15T13:00:00.000Z",
  ttl: 1810000000,
};

describe("AttributionEntrySchema", () => {
  it("accepts a complete entry", () => {
    expect(AttributionEntrySchema.safeParse(ATTRIBUTION_ENTRY).success).toBe(
      true,
    );
  });

  it("requires the costEstimated provenance flag (Rule 20.3)", () => {
    const withoutFlag: Record<string, unknown> = { ...ATTRIBUTION_ENTRY };
    delete withoutFlag.costEstimated;
    expect(AttributionEntrySchema.safeParse(withoutFlag).success).toBe(false);
  });

  it.each([
    ["cost", -0.01],
    ["inputTokens", 10.5],
    ["outputTokens", -1],
    ["invocations", "3"],
    ["costEstimated", "true"],
  ])("rejects invalid %s %j", (field, value) => {
    expect(
      AttributionEntrySchema.safeParse({ ...ATTRIBUTION_ENTRY, [field]: value })
        .success,
    ).toBe(false);
  });
});

describe("ModelUsageSchema", () => {
  const VALID_USAGE = {
    cost: 1.5,
    costEstimated: false,
    inputTokens: 1000,
    outputTokens: 200,
    invocations: 5,
    byUser: { "jane.doe@company.com": ATTRIBUTION_ENTRY },
    byService: { _untagged: ATTRIBUTION_ENTRY },
  };

  it("accepts an entry without rawModelIds (only meaningful on other)", () => {
    expect(ModelUsageSchema.safeParse(VALID_USAGE).success).toBe(true);
  });

  it("accepts rawModelIds as a list of strings", () => {
    expect(
      ModelUsageSchema.safeParse({
        ...VALID_USAGE,
        rawModelIds: ["amazon.titan-text-express-v1", "meta.llama3-70b"],
      }).success,
    ).toBe(true);
  });

  it("rejects non-string rawModelIds entries", () => {
    expect(
      ModelUsageSchema.safeParse({ ...VALID_USAGE, rawModelIds: [42] }).success,
    ).toBe(false);
  });

  it.each(["byUser", "byService"] as const)(
    "requires the %s attribution map",
    (field) => {
      const withoutMap: Record<string, unknown> = { ...VALID_USAGE };
      delete withoutMap[field];
      expect(ModelUsageSchema.safeParse(withoutMap).success).toBe(false);
    },
  );
});

describe("DailyRollupSchema", () => {
  it("accepts a valid rollup with nested byUser/byService inside each model", () => {
    const result = DailyRollupSchema.safeParse(VALID_ROLLUP);
    expect(result.success).toBe(true);
  });

  it("accepts an empty models map (no usage that day)", () => {
    expect(
      DailyRollupSchema.safeParse({ ...VALID_ROLLUP, models: {} }).success,
    ).toBe(true);
  });

  it("rejects a non-canonical model key", () => {
    const models = {
      ...VALID_ROLLUP.models,
      "gpt-4": VALID_ROLLUP.models["claude-sonnet"],
    };
    expect(
      DailyRollupSchema.safeParse({ ...VALID_ROLLUP, models }).success,
    ).toBe(false);
  });

  it("rejects byUser/byService hoisted to the top level of a model-less shape", () => {
    const hoisted = {
      ...VALID_ROLLUP,
      models: {},
      byUser: { "john.doe@company.com": ATTRIBUTION_ENTRY },
    };
    // Unknown top-level keys are stripped, not stored: the parsed output must
    // not carry a top-level byUser (Rule 20.4 — nested inside each model).
    const result = DailyRollupSchema.parse(hoisted);
    expect(result).not.toHaveProperty("byUser");
  });

  it("rejects a model entry missing its attribution maps", () => {
    const entryWithoutByUser: Record<string, unknown> = {
      ...VALID_ROLLUP.models["claude-sonnet"],
    };
    delete entryWithoutByUser.byUser;
    expect(
      DailyRollupSchema.safeParse({
        ...VALID_ROLLUP,
        models: { "claude-sonnet": entryWithoutByUser },
      }).success,
    ).toBe(false);
  });

  it.each([
    ["cost", -1],
    ["inputTokens", -5],
    ["outputTokens", 1.5],
    ["invocations", "12"],
    ["costFinalized", "false"],
    ["accountId", "abc"],
    ["lastUpdatedAt", "2026-05-15"],
    ["ttl", 0],
  ])("rejects invalid %s %j", (field, value) => {
    expect(
      DailyRollupSchema.safeParse({ ...VALID_ROLLUP, [field]: value }).success,
    ).toBe(false);
  });

  it.each(["cost", "inputTokens", "outputTokens", "invocations"])(
    "rejects a rollup missing the required total %s",
    (field) => {
      const incomplete: Record<string, unknown> = { ...VALID_ROLLUP };
      delete incomplete[field];
      expect(DailyRollupSchema.safeParse(incomplete).success).toBe(false);
    },
  );

  it("rejects a negative cost inside an attribution entry", () => {
    const models = {
      "claude-sonnet": {
        ...VALID_ROLLUP.models["claude-sonnet"],
        byUser: {
          "john.doe@company.com": { ...ATTRIBUTION_ENTRY, cost: -0.01 },
        },
      },
    };
    expect(
      DailyRollupSchema.safeParse({ ...VALID_ROLLUP, models }).success,
    ).toBe(false);
  });
});
