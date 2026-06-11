import { z } from "zod";

import { Iso8601Schema } from "./primitives";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: SyncStatus".
// A missing SyncStatus item is the "never synced" state, not an error
// (Rule 20.9) — consumers handle absence; this schema validates presence.

export const SYNC_STATUSES = ["success", "partial", "error"] as const;

export const SyncErrorSchema = z.object({
  accountId: z.string().min(1),
  message: z.string(),
});

export type SyncError = z.infer<typeof SyncErrorSchema>;

export const SyncStatusSchema = z.object({
  lastRunAt: Iso8601Schema,
  nextScheduledAt: Iso8601Schema,
  status: z.enum(SYNC_STATUSES),
  accountsTotal: z.number().int().nonnegative(),
  accountsSuccess: z.number().int().nonnegative(),
  accountsFailed: z.number().int().nonnegative(),
  errors: z.array(SyncErrorSchema),
  durationMs: z.number().nonnegative(),
});

export type SyncStatus = z.infer<typeof SyncStatusSchema>;
