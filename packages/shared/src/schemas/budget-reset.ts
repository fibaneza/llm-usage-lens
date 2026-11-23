import { z } from "zod";

import { Iso8601Schema } from "./primitives";

// Source: docs/specs/2026-05-15-data-model.md — "Budget reset entities (unit
// M4)"; docs/specs/2026-11-10-litellm.md — "Budget reset requests", MG-D8 to
// MG-D13; Access Control BR7 (the reason is plain text, length-capped).

export const BUDGET_RESET_REQUEST_STATUSES = [
  "open",
  "approving",
  "approved",
  "denied",
  "expired",
] as const;
export const BudgetResetRequestStatusSchema = z.enum(
  BUDGET_RESET_REQUEST_STATUSES,
);
export type BudgetResetRequestStatus = z.infer<
  typeof BudgetResetRequestStatusSchema
>;

// C0 controls except line feed, DEL, C1 controls and bidirectional
// formatting characters are refused (BR7).
const hasControlChar = (s: string): boolean =>
  Array.from(s).some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return (
      code <= 0x09 ||
      (code >= 0x0b && code <= 0x1f) ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x200e && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    );
  });
export const BudgetResetReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(280)
  .refine((s) => !hasControlChar(s), "control characters are not allowed");

export const CreateBudgetResetRequestInputSchema = z.strictObject({
  reason: BudgetResetReasonSchema.optional(),
});
export type CreateBudgetResetRequestInput = z.infer<
  typeof CreateBudgetResetRequestInputSchema
>;

export const BudgetResetRequestSchema = z.strictObject({
  requestId: z.uuid(),
  teamId: z.string().min(1),
  departmentId: z.string().min(1),
  litellmTeamId: z.string().min(1),
  requesterOid: z.string().min(1),
  reason: BudgetResetReasonSchema.nullable(),
  status: BudgetResetRequestStatusSchema,
  createdAt: Iso8601Schema,
  requestExpiresAt: Iso8601Schema,
  decidedBy: z.string().min(1).nullable(),
  decidedAt: Iso8601Schema.nullable(),
  resetId: z.uuid().nullable(),
  version: z.number().int().min(1),
});
export type BudgetResetRequest = z.infer<typeof BudgetResetRequestSchema>;

const Person = z.object({
  oid: z.string().min(1),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
});

export const BudgetResetRequestViewSchema = z.object({
  id: z.uuid(),
  teamId: z.string().min(1),
  teamName: z.string().nullable(),
  requester: Person,
  reason: z.string().nullable(),
  status: BudgetResetRequestStatusSchema,
  createdAt: Iso8601Schema,
  requestExpiresAt: Iso8601Schema,
  decidedAt: Iso8601Schema.nullable(),
  decidedBy: Person.nullable(),
});
export type BudgetResetRequestView = z.infer<
  typeof BudgetResetRequestViewSchema
>;

export const BudgetResetRequestListQuerySchema = z.strictObject({
  teamId: z.string().min(1).max(128),
  status: z.enum(["open", "all"]).default("open"),
  cursor: z.string().min(1).max(2048).optional(),
});

export const BudgetResetRequestListResponseSchema = z.object({
  items: z.array(BudgetResetRequestViewSchema),
  cursor: z.string().optional(),
  // Present when the caller may see counts only (Q-W2, auditor in prod).
  count: z.number().int().min(0).optional(),
});

export const BUDGET_RESET_INELIGIBLE_REASONS = [
  "no-team",
  "not-linked",
  "disabled",
  "open-request",
] as const;
export const MyBudgetResetRequestsSchema = z.object({
  teamId: z.string().nullable(),
  eligibility: z.object({
    canRequest: z.boolean(),
    reason: z.enum(BUDGET_RESET_INELIGIBLE_REASONS).nullable(),
  }),
  open: BudgetResetRequestViewSchema.nullable(),
  recent: z.array(BudgetResetRequestViewSchema).max(10),
});
export type MyBudgetResetRequests = z.infer<typeof MyBudgetResetRequestsSchema>;

export const ApproveBudgetResetResponseSchema = z.object({
  request: BudgetResetRequestViewSchema,
  resetId: z.uuid(),
  amount: z.number().min(0),
});
export const DenyBudgetResetResponseSchema = z.object({
  request: BudgetResetRequestViewSchema,
});

export const BUDGET_RESET_TRIGGERS = ["direct", "request"] as const;
// Data Model - BudgetReset (amended 2026-11-19, RS2, D-RS8): a union on
// `scope`; oid, teamId and departmentId exist only where the person or team
// is known to the app. A user-scope reset has no LiteLLM team.
const BudgetResetCommon = {
  resetId: z.uuid(),
  oid: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  litellmUserId: z.string().min(1),
  amount: z.number().min(0),
  budget: z.number().min(0).nullable(),
  trigger: z.enum(BUDGET_RESET_TRIGGERS),
  actorOid: z.string().min(1),
  requestId: z.string().min(1),
  timestamp: Iso8601Schema,
};
export const BudgetResetSchema = z.discriminatedUnion("scope", [
  z.strictObject({
    scope: z.literal("member"),
    ...BudgetResetCommon,
    litellmTeamId: z.string().min(1),
    operation: z.enum(["spend", "budget"]),
  }),
  z.strictObject({
    scope: z.literal("user"),
    ...BudgetResetCommon,
    operation: z.literal("spend"),
  }),
]);
export type BudgetReset = z.infer<typeof BudgetResetSchema>;

// Open for L7 to append its own kinds; nothing here is key-specific.
export const NOTIFICATION_KINDS = [
  "budget-reset.requested",
  "budget-reset.approved",
  "budget-reset.denied",
  "budget-reset.expired",
] as const;
export const NotificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

// The API id is the item's SK: `{createdAt}#{notificationId}`.
export const NotificationIdSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

export const NotificationSchema = z.strictObject({
  notificationId: z.uuid(),
  recipientOid: z.string().min(1),
  kind: NotificationKindSchema,
  requestId: z.uuid(),
  teamId: z.string().min(1),
  createdAt: Iso8601Schema,
  readAt: Iso8601Schema.nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationViewSchema = z.object({
  id: NotificationIdSchema,
  kind: NotificationKindSchema,
  createdAt: Iso8601Schema,
  read: z.boolean(),
  teamId: z.string().min(1),
  requestId: z.uuid(),
  // Null when the caller may no longer read the request (BR8).
  request: BudgetResetRequestViewSchema.nullable(),
  canDecide: z.boolean(),
});
export type NotificationView = z.infer<typeof NotificationViewSchema>;

export const NotificationListQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(2048).optional(),
});
export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationViewSchema),
  unreadCount: z.number().int().min(0),
  cursor: z.string().optional(),
});

export const MarkNotificationsReadInputSchema = z.union([
  z.strictObject({ ids: z.array(NotificationIdSchema).min(1).max(50) }),
  z.strictObject({ all: z.literal(true) }),
]);
export const MarkNotificationsReadResponseSchema = z.object({
  updated: z.number().int().min(0),
});
