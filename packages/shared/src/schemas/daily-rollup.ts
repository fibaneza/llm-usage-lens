import { z } from "zod";

import { ModelKeySchema } from "../models";
import { AccountIdSchema, Iso8601Schema } from "./primitives";

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

export const DailyRollupSchema = z.object({
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

  lastUpdatedAt: Iso8601Schema,
  ttl: z.number().int().positive(),
});

export type DailyRollup = z.infer<typeof DailyRollupSchema>;
