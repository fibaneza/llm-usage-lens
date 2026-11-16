import { describe, expect, it } from "vitest";

import {
  AttributionEntrySchema,
  DailyRollupBaseSchema,
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
      DailyRollupSchema.safeParse({ ...VALID_ROLLUP, cost: 0, models: {} })
        .success,
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
      cost: 0,
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

// Source: docs/specs/2026-05-15-data-model.md — "Non-Model Charges" (Rules 1,
// 4, 5, Backward compatibility) and implementation-phases "Phase 3.1a".
describe("DailyRollupSchema — nonModel (Phase 3.1a)", () => {
  const MODEL_SUM = 12.345678;
  const GUARDRAILS = {
    cost: 0.5,
    costEstimated: false,
    recurring: false,
    usageQuantity: 1200,
    usageUnit: "TextUnits",
    rawUsageTypes: ["USE1-Guardrail-ContentPolicy-Units"],
  };
  const PROVISIONED = {
    cost: 24,
    costEstimated: false,
    recurring: true,
    usageQuantity: 24,
    usageUnit: "Hrs",
    rawUsageTypes: ["USE1-ProvisionedThroughput-ModelUnit-ClaudeSonnet"],
  };

  const withNonModel = (nonModel: unknown, cost = MODEL_SUM + 0.5) => ({
    ...VALID_ROLLUP,
    cost,
    nonModel,
  });

  it("still parses a pre-amendment item with no nonModel (backward compatible)", () => {
    const result = DailyRollupSchema.safeParse(VALID_ROLLUP);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.nonModel).toBeUndefined();
  });

  it("accepts a rollup with a nonModel map when the cost invariant holds", () => {
    const result = DailyRollupSchema.safeParse(
      withNonModel({ guardrails: GUARDRAILS }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nonModel?.guardrails?.cost).toBe(0.5);
      expect(result.data.nonModel?.guardrails?.rawUsageTypes).toEqual([
        "USE1-Guardrail-ContentPolicy-Units",
      ]);
    }
  });

  it("accepts an empty nonModel map (invariant: second term is 0)", () => {
    expect(
      DailyRollupSchema.safeParse(withNonModel({}, MODEL_SUM)).success,
    ).toBe(true);
  });

  it("accepts several categories whose costs sum into the total", () => {
    expect(
      DailyRollupSchema.safeParse(
        withNonModel(
          { guardrails: GUARDRAILS, "provisioned-throughput": PROVISIONED },
          MODEL_SUM + 0.5 + 24,
        ),
      ).success,
    ).toBe(true);
  });

  it("accepts an idle recurring day: models {} with only Provisioned Throughput", () => {
    const idle = {
      ...VALID_ROLLUP,
      cost: 24,
      inputTokens: 0,
      outputTokens: 0,
      invocations: 0,
      models: {},
      nonModel: { "provisioned-throughput": PROVISIONED },
    };
    expect(DailyRollupSchema.safeParse(idle).success).toBe(true);
  });

  it("accepts a real zero-cost nonModel row (Rule 4: cost 0 is allowed)", () => {
    expect(
      DailyRollupSchema.safeParse(
        withNonModel({ guardrails: { ...GUARDRAILS, cost: 0 } }, MODEL_SUM),
      ).success,
    ).toBe(true);
  });

  it("rejects an unknown nonModel category key", () => {
    expect(
      DailyRollupSchema.safeParse(withNonModel({ "made-up": GUARDRAILS }))
        .success,
    ).toBe(false);
  });

  it("rejects a nonModel entry carrying token fields", () => {
    const withTokens = { ...GUARDRAILS, inputTokens: 10, outputTokens: 5 };
    expect(
      DailyRollupSchema.safeParse(withNonModel({ guardrails: withTokens }))
        .success,
    ).toBe(false);
  });

  it("rejects a total that exceeds Σ models + Σ nonModel", () => {
    expect(
      DailyRollupSchema.safeParse(
        withNonModel({ guardrails: GUARDRAILS }, MODEL_SUM + 0.5 + 1),
      ).success,
    ).toBe(false);
  });

  it("rejects a total that omits nonModel cost (model sum only)", () => {
    expect(
      DailyRollupSchema.safeParse(
        withNonModel({ guardrails: GUARDRAILS }, MODEL_SUM),
      ).success,
    ).toBe(false);
  });

  it("rejects an invariant violation when nonModel is absent", () => {
    expect(
      DailyRollupSchema.safeParse({ ...VALID_ROLLUP, cost: 99 }).success,
    ).toBe(false);
  });

  it("tolerates sub-6-decimal float drift in the invariant", () => {
    expect(
      DailyRollupSchema.safeParse(
        withNonModel({ guardrails: GUARDRAILS }, MODEL_SUM + 0.5 + 4e-7),
      ).success,
    ).toBe(true);
  });

  it("rejects drift larger than the 6-decimal tolerance", () => {
    expect(
      DailyRollupSchema.safeParse(
        withNonModel({ guardrails: GUARDRAILS }, MODEL_SUM + 0.5 + 1e-4),
      ).success,
    ).toBe(false);
  });
});

// Source: docs/specs/2026-05-15-data-model.md — "Backward compatibility".
// The refined schema cannot be picked/omitted (Zod 4), so response schemas
// derive from the unrefined base.
describe("DailyRollupBaseSchema", () => {
  const VIOLATING = { ...VALID_ROLLUP, cost: 99 };

  it("parses an item whose cost violates the invariant, while DailyRollupSchema rejects it", () => {
    expect(DailyRollupBaseSchema.safeParse(VIOLATING).success).toBe(true);
    expect(DailyRollupSchema.safeParse(VIOLATING).success).toBe(false);
  });

  it("supports .pick()", () => {
    const Picked = DailyRollupBaseSchema.pick({ accountId: true, cost: true });
    expect(
      Picked.safeParse({ accountId: "000000000000", cost: 1.5 }).success,
    ).toBe(true);
    expect(Picked.safeParse({ accountId: "000000000000" }).success).toBe(false);
  });

  it("supports .omit()", () => {
    const Omitted = DailyRollupBaseSchema.omit({ models: true });
    const withoutModels: Record<string, unknown> = { ...VALID_ROLLUP };
    delete withoutModels.models;
    expect(Omitted.safeParse(withoutModels).success).toBe(true);
  });
});

// Source: docs/specs/2026-05-15-data-model.md — "`date` attribute (audit A2;
// adopted 2026-10-28)": optional `YYYY-MM-DD` (UTC, Rule 20.1) so items
// written before it existed still parse; implementation-phases "Phase 3.1a".
describe.each([
  ["DailyRollupSchema", DailyRollupSchema],
  ["DailyRollupBaseSchema", DailyRollupBaseSchema],
] as const)("%s — date attribute (Phase 3.1a)", (_name, schema) => {
  it("accepts a valid UTC YYYY-MM-DD date and preserves it", () => {
    const result = schema.safeParse({ ...VALID_ROLLUP, date: "2026-10-27" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.date).toBe("2026-10-27");
  });

  it("accepts a leap day", () => {
    const result = schema.safeParse({ ...VALID_ROLLUP, date: "2028-02-29" });
    expect(result.success).toBe(true);
  });

  it("still parses a rollup without date (backward compatible)", () => {
    const result = schema.safeParse(VALID_ROLLUP);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.date).toBeUndefined();
  });

  it.each([
    ["month 13", "2026-13-01"],
    ["impossible day", "2026-02-31"],
    ["non-leap Feb 29", "2027-02-29"],
    ["slashes", "2026/10/27"],
    ["no separators", "20261027"],
    ["timestamp", "2026-10-27T00:00:00Z"],
    ["empty string", ""],
    ["a number", 20261027],
    ["null", null],
  ])("rejects a malformed date (%s)", (_label, date) => {
    expect(schema.safeParse({ ...VALID_ROLLUP, date }).success).toBe(false);
  });
});
