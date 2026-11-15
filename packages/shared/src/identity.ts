import { z } from "zod";

import { Iso8601Schema } from "./schemas/primitives";

// Source: docs/specs/2026-11-10-access-control.md — "Data model additions"
// (Identity row). PK=IDENT#{oid}, SK=META, gsi1pk=IDENTS, gsi1sk=IDENT#{oid}.
export const IdentityRecordSchema = z.object({
  oid: z.string().min(1),
  tid: z.string().min(1),
  email: z.string().optional(),
  upn: z.string().optional(),
  displayName: z.string().optional(),
  lastSignInAt: Iso8601Schema,
  lastSeenRoles: z.array(z.string()),
  authMethod: z.enum(["entra", "master", "local", "password"]),
  version: z.number().int().min(0),
  ambiguousMembership: z.boolean().optional(),
  groupsOverage: z.boolean().optional(),
  failedAttempts: z.number().int().min(0).optional(),
  lockedUntil: Iso8601Schema.optional(),
});
export type IdentityRecord = z.infer<typeof IdentityRecordSchema>;
