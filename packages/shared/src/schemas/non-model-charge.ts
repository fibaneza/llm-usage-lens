import { z } from "zod";

// Source: docs/specs/2026-05-15-data-model.md — "Non-Model Charges".
// Closed key list: a new Bedrock charge class is a spec change, so unknown
// keys must fail validation rather than silently pass through.
export const NON_MODEL_CATEGORIES = [
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
] as const;

export const NonModelCategorySchema = z.enum(NON_MODEL_CATEGORIES);

export type NonModelCategory = z.infer<typeof NonModelCategorySchema>;

// Strict on purpose: token/invocation fields must never appear on a non-model
// charge (data-model spec, "Non-Model Charges").
export const NonModelChargeSchema = z.strictObject({
  cost: z.number().nonnegative(),
  costEstimated: z.boolean(),
  recurring: z.boolean(),
  usageQuantity: z.number().nonnegative().optional(),
  usageUnit: z.string().optional(),
  rawUsageTypes: z.array(z.string().min(1)).min(1),
});

export type NonModelCharge = z.infer<typeof NonModelChargeSchema>;
