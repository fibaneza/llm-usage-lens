import { z } from "zod";

import { Iso8601Schema } from "./primitives";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user sync"
// (Users table, Pending LiteLLM links, Teams, Preview and apply, Records),
// "Data model additions" (PendingLiteLLMLink); LiteLLM spec LD40; T-SY1, T-SY5,
// T-SY7, T-SY10. Field names are agent decisions (2026-11-24, unit SYNC1):
// the spec fixes behaviour, not names. No schema here carries `sso_user_id`
// (S20: LiteLLM's Entra id is compared on the server and never returned).

export const LiteLLMSyncBodySchema = z.strictObject({
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const LITELLM_SYNC_TRIGGERS = ["manual", "schedule"] as const;
export const LiteLLMSyncTriggerSchema = z.enum(LITELLM_SYNC_TRIGGERS);

export const LITELLM_SYNC_SKIP_REASONS = [
  "no-email",
  "duplicate-email",
  "ambiguous-identity",
  "privileged",
  "service-user",
  "claimed",
  "identity-linked-elsewhere",
  "own-identity",
] as const;
export const LiteLLMSyncSkipReasonSchema = z.enum(LITELLM_SYNC_SKIP_REASONS);

export const LITELLM_SYNC_MEMBERSHIP_REASONS = [
  "multiple-teams",
  "other-team",
  "own-identity",
  "removal-guard",
] as const;
export const LiteLLMSyncMembershipReasonSchema = z.enum(
  LITELLM_SYNC_MEMBERSHIP_REASONS,
);

// A person the sync did not place: the two team reasons, or no linked team.
export const LiteLLMSyncNotPlacedReasonSchema = z.enum([
  "multiple-teams",
  "other-team",
  "no-linked-team",
]);

export const LITELLM_SYNC_ERROR_CODES = [
  "PLAN_CHANGED",
  "SYNC_RUNNING",
  "PLAN_TRUNCATED",
] as const;
export const LiteLLMSyncErrorCodeSchema = z.enum(LITELLM_SYNC_ERROR_CODES);

const SyncIdSchema = z.string().min(1).max(256);

const userBase = { litellmUserId: SyncIdSchema, email: z.string().min(1) };

export const LiteLLMSyncUserRowSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    ...userBase,
    outcome: z.literal("link-existing"),
    oid: SyncIdSchema,
    matchedKey: z.enum(["oid", "email"]),
  }),
  z.strictObject({ ...userBase, outcome: z.literal("create-pending") }),
  z.strictObject({ ...userBase, outcome: z.literal("already-linked") }),
  z.strictObject({ ...userBase, outcome: z.literal("already-pending") }),
  z.strictObject({
    ...userBase,
    outcome: z.literal("remove-pending"),
    reason: z.literal("removal-guard").optional(),
  }),
  z.strictObject({
    ...userBase,
    outcome: z.literal("skip"),
    reason: LiteLLMSyncSkipReasonSchema,
  }),
]);

export const LiteLLMSyncMembershipRowSchema = z.strictObject({
  litellmUserId: SyncIdSchema,
  teamId: SyncIdSchema,
  outcome: z.enum(["add-member", "add-pending-member", "skip"]),
  reason: LiteLLMSyncMembershipReasonSchema.optional(),
});

export const LiteLLMSyncDriftRowSchema = z.strictObject({
  kind: z.enum(["not-in-litellm-team", "not-in-litellm"]),
  oid: SyncIdSchema,
  teamId: SyncIdSchema.optional(),
});

export const LiteLLMSyncNotPlacedRowSchema = z.strictObject({
  litellmUserId: SyncIdSchema,
  reason: LiteLLMSyncNotPlacedReasonSchema,
});

export const LiteLLMSyncCountsSchema = z.strictObject({
  toLink: z.number().int().min(0),
  toPend: z.number().int().min(0),
  alreadyLinked: z.number().int().min(0),
  skipped: z.number().int().min(0),
  memberships: z.number().int().min(0),
});

export const LiteLLMSyncPlanResponseSchema = z.discriminatedUnion(
  "configured",
  [
    z.strictObject({ configured: z.literal(false) }),
    z.strictObject({
      configured: z.literal(true),
      users: z.array(LiteLLMSyncUserRowSchema),
      memberships: z.array(LiteLLMSyncMembershipRowSchema),
      drift: z.array(LiteLLMSyncDriftRowSchema),
      notPlaced: z.array(LiteLLMSyncNotPlacedRowSchema),
      counts: LiteLLMSyncCountsSchema,
      truncated: z.boolean(),
      planHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ],
);

// One applied or refused change; a refused single change is a result row.
export const LiteLLMSyncResultRowSchema = z.strictObject({
  litellmUserId: SyncIdSchema,
  outcome: z.string().min(1),
  status: z.enum(["applied", "refused"]),
  reason: z.string().min(1).optional(),
});

export const LiteLLMSyncResultSchema = z.strictObject({
  runId: z.string().min(1),
  results: z.strictObject({
    users: z.array(LiteLLMSyncResultRowSchema),
    memberships: z.array(LiteLLMSyncResultRowSchema),
    notPlaced: z.array(LiteLLMSyncNotPlacedRowSchema),
  }),
  remaining: z.number().int().min(0),
});

// The key is the lower-cased email or an Entra oid (Data model additions).
export const PendingLiteLLMLinkSchema = z.strictObject({
  emailOrOid: z
    .string()
    .min(1)
    .refine((v) => v === v.toLowerCase(), {
      message: "the pending key is lower-cased",
    }),
  litellmUserId: SyncIdSchema,
  source: z.literal("sync"),
  version: z.number().int().min(1),
  createdAt: Iso8601Schema,
  createdBy: z.string().min(1),
  lastValidatedAt: Iso8601Schema,
});

// GET /api/identities/pending-links: one page (25 rows, opaque cursor) and the
// DELETE body (Access Control - API routes (additions)). The row names only
// what the panel shows; the stored Entra reference is never returned (S20).
// `email` is present only for an email-keyed link; any other row is named by
// its LiteLLM user id (amended 2026-11-24).
export const PendingLinkRowSchema = z.strictObject({
  email: z.string().min(1).optional(),
  litellmUserId: SyncIdSchema,
  version: z.number().int().min(1),
  createdAt: Iso8601Schema,
});
export const PendingLinksPageSchema = z.strictObject({
  items: z.array(PendingLinkRowSchema),
  cursor: z.string().min(1).optional(),
});
export const PendingLinkDeleteBodySchema = z.union([
  z.strictObject({
    email: z.string().trim().min(1).max(320),
    version: z.number().int().min(1),
  }),
  z.strictObject({
    litellmUserId: SyncIdSchema,
    version: z.number().int().min(1),
  }),
]);
export const PendingLinkRemovedSchema = z.union([
  z.strictObject({ email: z.string().min(1) }),
  z.strictObject({ litellmUserId: SyncIdSchema }),
]);

export type LiteLLMSyncTrigger = z.infer<typeof LiteLLMSyncTriggerSchema>;
export type LiteLLMSyncUserRow = z.infer<typeof LiteLLMSyncUserRowSchema>;
export type LiteLLMSyncMembershipRow = z.infer<
  typeof LiteLLMSyncMembershipRowSchema
>;
export type LiteLLMSyncPlanResponse = z.infer<
  typeof LiteLLMSyncPlanResponseSchema
>;
export type LiteLLMSyncResult = z.infer<typeof LiteLLMSyncResultSchema>;
export type PendingLiteLLMLink = z.infer<typeof PendingLiteLLMLinkSchema>;
