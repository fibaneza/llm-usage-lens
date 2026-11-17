import { z } from "zod";

import { dailySk, datePk } from "../table";
import {
  COST_INVARIANT_REFINEMENT,
  DailyRollupBaseSchema,
  hasConsistentCost,
} from "./daily-rollup";
import { UtcDaySchema } from "./primitives";

// Write-side DailyRollup item: the rollup fields plus the DynamoDB key
// attributes, with a REQUIRED `date` that must agree with SK and gsi1pk.
// Source: docs/specs/2026-05-15-data-model.md — "`date` attribute (audit A2;
// adopted 2026-10-28)" and "Entity Map". Used by the seed scripts and the
// Phase 6 collector; read paths use DailyRollupSchema.
export const DailyRollupItemSchema = DailyRollupBaseSchema.extend({
  PK: z.string().min(1),
  SK: z.string().min(1),
  gsi1pk: z.string().min(1),
  gsi1sk: z.string().min(1),
  date: UtcDaySchema,
  // Required on write: the table TTL attribute (data-model spec — "TTL attribute `expiresAt`").
  expiresAt: z.number().int().positive(),
})
  .refine(hasConsistentCost, COST_INVARIANT_REFINEMENT)
  .refine((item) => item.SK === dailySk(item.date), {
    message: "SK must equal DAILY#{date}",
    path: ["SK"],
  })
  .refine((item) => item.gsi1pk === datePk(item.date), {
    message: "gsi1pk must equal DATE#{date}",
    path: ["gsi1pk"],
  });

export type DailyRollupItem = z.infer<typeof DailyRollupItemSchema>;
