import { describe, expect, it } from "vitest";

import {
  NonModelCategorySchema,
  NonModelChargeSchema,
} from "./non-model-charge";

// Source: docs/specs/2026-05-15-data-model.md — "Non-Model Charges"
// (Charge categories table; closed key list) and implementation-phases
// "Phase 3.1a". The spec names NonModelCategorySchema / NonModelChargeSchema
// but not the file; the phases spec places them in packages/shared/src/schemas/.

const CATEGORY_KEYS = [
  "guardrails",
  "provisioned-throughput",
  "custom-model-storage",
  "custom-model-import",
  "model-customization",
  "knowledge-bases",
  "agents",
  "flows",
  "data-automation",
  "model-evaluation",
  "other-features",
  "unclassified",
];

const VALID_CHARGE = {
  cost: 1.25,
  costEstimated: false,
  recurring: true,
  usageQuantity: 24,
  usageUnit: "Hrs",
  rawUsageTypes: ["USE1-ProvisionedThroughput-ModelUnit"],
};

describe("NonModelCategorySchema", () => {
  it.each(CATEGORY_KEYS)("accepts the canonical key %s", (key) => {
    expect(NonModelCategorySchema.safeParse(key).success).toBe(true);
  });

  it("is a closed list of exactly the 12 spec categories", () => {
    expect([...NonModelCategorySchema.options].sort()).toEqual(
      [...CATEGORY_KEYS].sort(),
    );
  });

  it.each(["made-up", "", "Guardrails", "claude-sonnet", "other"])(
    "rejects the unknown key %j",
    (key) => {
      expect(NonModelCategorySchema.safeParse(key).success).toBe(false);
    },
  );

  it.each([undefined, null, 1])("rejects non-string %j", (value) => {
    expect(NonModelCategorySchema.safeParse(value).success).toBe(false);
  });
});

describe("NonModelChargeSchema", () => {
  it("accepts a complete entry", () => {
    expect(NonModelChargeSchema.safeParse(VALID_CHARGE).success).toBe(true);
  });

  it("accepts an entry without the optional usageQuantity/usageUnit", () => {
    const minimal: Record<string, unknown> = { ...VALID_CHARGE };
    delete minimal.usageQuantity;
    delete minimal.usageUnit;
    expect(NonModelChargeSchema.safeParse(minimal).success).toBe(true);
  });

  it("accepts a real zero-cost entry (Rule 4)", () => {
    expect(
      NonModelChargeSchema.safeParse({ ...VALID_CHARGE, cost: 0 }).success,
    ).toBe(true);
  });

  it("accepts costEstimated true or false (boolean provenance flag)", () => {
    expect(
      NonModelChargeSchema.safeParse({ ...VALID_CHARGE, costEstimated: true })
        .success,
    ).toBe(true);
  });

  it("rejects a negative cost", () => {
    expect(
      NonModelChargeSchema.safeParse({ ...VALID_CHARGE, cost: -0.01 }).success,
    ).toBe(false);
  });

  it("rejects a negative usageQuantity", () => {
    expect(
      NonModelChargeSchema.safeParse({ ...VALID_CHARGE, usageQuantity: -1 })
        .success,
    ).toBe(false);
  });

  it.each(["cost", "costEstimated", "recurring", "rawUsageTypes"])(
    "rejects an entry missing required field %s",
    (field) => {
      const incomplete: Record<string, unknown> = { ...VALID_CHARGE };
      delete incomplete[field];
      expect(NonModelChargeSchema.safeParse(incomplete).success).toBe(false);
    },
  );

  it.each([
    ["cost", "1.25"],
    ["costEstimated", "false"],
    ["recurring", "true"],
    ["usageQuantity", "24"],
    ["usageUnit", 5],
    ["rawUsageTypes", "USE1-Guardrail"],
  ])("rejects a wrongly typed %s", (field, value) => {
    expect(
      NonModelChargeSchema.safeParse({ ...VALID_CHARGE, [field]: value })
        .success,
    ).toBe(false);
  });

  it("rejects non-string rawUsageTypes entries", () => {
    expect(
      NonModelChargeSchema.safeParse({ ...VALID_CHARGE, rawUsageTypes: [1] })
        .success,
    ).toBe(false);
  });

  it("rejects an empty rawUsageTypes list (a charge must trace to at least one usage type)", () => {
    expect(
      NonModelChargeSchema.safeParse({ ...VALID_CHARGE, rawUsageTypes: [] })
        .success,
    ).toBe(false);
  });

  it("rejects an empty-string entry in rawUsageTypes", () => {
    expect(
      NonModelChargeSchema.safeParse({ ...VALID_CHARGE, rawUsageTypes: [""] })
        .success,
    ).toBe(false);
  });

  it.each([
    ["inputTokens", 100],
    ["outputTokens", 50],
    ["invocations", 3],
    ["byUser", {}],
    ["byService", {}],
  ])(
    "is strict: rejects model-only field %s (Rule 3 — never present as tokens)",
    (field, value) => {
      expect(
        NonModelChargeSchema.safeParse({ ...VALID_CHARGE, [field]: value })
          .success,
      ).toBe(false);
    },
  );
});
