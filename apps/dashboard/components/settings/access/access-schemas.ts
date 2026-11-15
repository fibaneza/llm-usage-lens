import { IdentityRecordSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)":
// every list answers `{ items, cursor? }` with an opaque cursor (Rule 20.6).
export function pageOf<S extends z.ZodType>(item: S) {
  return z.object({ items: z.array(item), cursor: z.string().optional() });
}

// The list row of GET /api/identities (the route's own pick of the record).
export const IdentityItemSchema = IdentityRecordSchema.pick({
  oid: true,
  email: true,
  displayName: true,
  authMethod: true,
  lastSignInAt: true,
});
export type IdentityItem = z.infer<typeof IdentityItemSchema>;

export const PerUserApprovalStateSchema = z.discriminatedUnion("approved", [
  z.object({ approved: z.literal(false) }),
  z.object({
    approved: z.literal(true),
    approvedBy: z.string(),
    approvedAt: z.string(),
    reference: z.string(),
    version: z.number().int().min(0),
  }),
]);

export const PasswordSignInSchema = z.object({
  enabled: z.boolean(),
  version: z.number().int().min(0),
});

export const PasswordUserWithLinkSchema = z.object({
  setupLink: z.string().min(1),
});

// A write whose response body the UI does not read.
export const IgnoredSchema = z.unknown();
