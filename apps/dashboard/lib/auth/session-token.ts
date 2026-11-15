import { z } from "zod";

// Source: docs/specs/2026-11-10-access-control.md — Threat model T1/T8: a
// session token missing its identity claims is rejected (fail closed).
const SessionTokenSchema = z.object({
  oid: z.string().min(1),
  tid: z.string().min(1),
  roles: z.array(z.string()),
  authMethod: z.enum(["entra", "master", "local", "password"]),
  // Epoch seconds of the credential check (D28); absent on pre-D28 sessions.
  authTime: z.number().int().optional(),
  // Password sessions: the user's credential version at sign-in (D29).
  credentialVersion: z.number().int().min(0).optional(),
});

export type SessionTokenClaims = z.infer<typeof SessionTokenSchema>;

export function parseSessionToken(
  token: Record<string, unknown>,
): SessionTokenClaims | null {
  const parsed = SessionTokenSchema.safeParse(token);
  return parsed.success ? parsed.data : null;
}
