import { z } from "zod";

import { ModelKeySchema } from "../models";
import {
  NonModelCategorySchema,
  NonModelChargeSchema,
} from "./non-model-charge";
import { AccountIdSchema, Iso8601Schema, UtcDaySchema } from "./primitives";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: DailyRollup".
// Model is the primary breakdown dimension; byUser and byService are nested
// inside each model entry, never at the top level (Rule 20.4).

const usageMetrics = {
  cost: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  invocations: z.number().int().nonnegative(),
};

// Per-user / per-service entry. Tokens and invocations are exact (CloudTrail);
// cost is a proportional estimate and always carries costEstimated (Rule 20.3).
export const AttributionEntrySchema = z.object({
  ...usageMetrics,
  costEstimated: z.boolean(),
});

export type AttributionEntry = z.infer<typeof AttributionEntrySchema>;

export const ModelUsageSchema = z.object({
  ...usageMetrics,
  costEstimated: z.boolean(),
  // Only meaningful on the "other" entry — raw IDs not yet mapped.
  rawModelIds: z.array(z.string()).optional(),
  byUser: z.record(z.string(), AttributionEntrySchema),
  byService: z.record(z.string(), AttributionEntrySchema),
});

export type ModelUsage = z.infer<typeof ModelUsageSchema>;

const COST_INVARIANT_TOLERANCE = 1e-6;

const sumCosts = (entries: ReadonlyArray<{ cost: number } | undefined>) =>
  entries.reduce((total, entry) => total + (entry?.cost ?? 0), 0);

// Cost invariant (data-model spec, "Non-Model Charges"): the day total is the
// model charges plus the non-model charges. Tolerance absorbs float drift.
// Shared by DailyRollupSchema and the write-side DailyRollupItemSchema.
export const hasConsistentCost = (rollup: {
  cost: number;
  models: Record<string, { cost: number } | undefined>;
  nonModel?: Record<string, { cost: number } | undefined> | undefined;
}): boolean =>
  Math.abs(
    rollup.cost -
      (sumCosts(Object.values(rollup.models)) +
        sumCosts(Object.values(rollup.nonModel ?? {}))),
  ) <= COST_INVARIANT_TOLERANCE;

export const COST_INVARIANT_REFINEMENT = {
  message:
    "cost must equal Σ models[*].cost + Σ nonModel[*].cost (within 1e-6)",
  path: ["cost"],
};

// Unrefined base: Zod 4 throws on .pick/.omit/.partial/.merge of a refined
// object, so Phase 3.3 response schemas derive from this, not DailyRollupSchema.
export const DailyRollupBaseSchema = z.object({
  // UTC calendar day of the rollup (audit A2; data-model spec, "`date`
  // attribute"). Optional so items written before it existed still parse.
  date: UtcDaySchema.optional(),

  accountId: AccountIdSchema,
  departmentId: z.string().min(1),
  departmentName: z.string().min(1),
  teamId: z.string().min(1),
  teamName: z.string().min(1),

  cost: z.number().nonnegative(),
  costFinalized: z.boolean(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  invocations: z.number().int().nonnegative(),

  // Keyed by canonical model key; a rollup carries only the models actually
  // used that day, so the record is partial (unknown keys are rejected).
  models: z.partialRecord(ModelKeySchema, ModelUsageSchema),

  // Non-model Bedrock charges (Guardrails, Provisioned Throughput, ...). Optional
  // so pre-amendment items still parse — docs/specs/2026-05-15-data-model.md,
  // "Non-Model Charges" (Backward compatibility).
  nonModel: z
    .partialRecord(NonModelCategorySchema, NonModelChargeSchema)
    .optional(),

  lastUpdatedAt: Iso8601Schema,
  ttl: z.number().int().positive(),
});

export const DailyRollupSchema = DailyRollupBaseSchema.refine(
  hasConsistentCost,
  COST_INVARIANT_REFINEMENT,
);

// Read-side rollup with a REQUIRED `date` (data-model spec, "`date` attribute":
// data-access functions return `date` on every rollup). Same cost invariant.
export const DatedDailyRollupSchema = DailyRollupBaseSchema.extend({
  date: UtcDaySchema,
}).refine(hasConsistentCost, COST_INVARIANT_REFINEMENT);

export type DatedDailyRollup = z.infer<typeof DatedDailyRollupSchema>;

export type DailyRollup = z.infer<typeof DailyRollupSchema>;
