import { z } from "zod";

// Source: docs/specs/2026-11-10-access-control.md — Threat model T1/T8: a
// session token missing its identity claims is rejected (fail closed).
const SessionTokenSchema = z.object({
  oid: z.string().min(1),
  tid: z.string().min(1),
  roles: z.array(z.string()),
  authMethod: z.enum(["entra", "master", "local"]),
});

export type SessionTokenClaims = z.infer<typeof SessionTokenSchema>;

export function parseSessionToken(
  token: Record<string, unknown>,
): SessionTokenClaims | null {
  const parsed = SessionTokenSchema.safeParse(token);
  return parsed.success ? parsed.data : null;
}
