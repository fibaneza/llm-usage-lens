import { z } from "zod";

import { DateRangeQuerySchema } from "./queries";

// Source: docs/specs/2026-11-10-litellm.md — MG-D9, MG-D10 (slice B);
// docs/specs/2026-05-15-data-model.md — "API Routes" (`/api/budget-resets`).

export const BudgetResetCountsQuerySchema = DateRangeQuerySchema.and(
  z.object({ teamId: z.string().min(1).max(128).optional() }),
);

const Tally = z.object({
  count: z.number().int().min(0),
  amount: z.number().min(0),
});

export const BudgetResetCountsSchema = z.object({
  teams: z.array(
    Tally.extend({
      teamId: z.string().min(1),
      // Present only when per-user data is allowed for the caller (MG-D10).
      members: z.array(Tally.extend({ oid: z.string().min(1) })).optional(),
    }),
  ),
  own: Tally,
});
export type BudgetResetCounts = z.infer<typeof BudgetResetCountsSchema>;
