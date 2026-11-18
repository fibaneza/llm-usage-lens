import { z } from "zod";

// Source: docs/specs/2026-11-10-litellm.md - `resetMemberSpend` row (RS1), LD37
// (`configured: false` only when not configured), LD23 (spend and budget are
// omitted under the Organisation cap); Design System - "Reset spend from the
// LiteLLM users tab and the Users page" (a null budget is unlimited).
// `teamId` is the dashboard team id, never a LiteLLM team id.

export const LiteLLMUserMembershipSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  spend: z.number().nonnegative().optional(),
  maxBudget: z.number().nullable().optional(),
});

export const LiteLLMUserMembershipsResponseSchema = z.object({
  configured: z.literal(false).optional(),
  items: z.array(LiteLLMUserMembershipSchema),
});

export type LiteLLMUserMembership = z.infer<typeof LiteLLMUserMembershipSchema>;
export type LiteLLMUserMembershipsResponse = z.infer<
  typeof LiteLLMUserMembershipsResponseSchema
>;
