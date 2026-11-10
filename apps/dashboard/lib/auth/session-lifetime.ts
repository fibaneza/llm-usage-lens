import { z } from "zod";

// Source: docs/specs/2026-05-15-system-architecture.md — "Authentication &
// Access" → "Account-mutation role": a session ends 8 hours after sign-in
// regardless of activity. Auth.js re-issues the JWT on every request, so
// `maxAge` alone is only an idle timeout; the jwt callback in `auth.ts` records
// `signedInAt` at sign-in and rejects tokens older than this cap.
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

// A sign-in time up to this far in the future is tolerated as clock skew; a
// later one would outlive the cap, so it is rejected (same spec section).
export const SESSION_CLOCK_SKEW_SECONDS = 60;

// Zod v4 numbers reject NaN and Infinity, so a malformed value fails closed.
const SignedInAtSchema = z.number();

export function isWithinSessionLifetime(
  signedInAt: unknown,
  nowSeconds: number,
  capSeconds: number = SESSION_MAX_AGE_SECONDS,
): boolean {
  const parsed = SignedInAtSchema.safeParse(signedInAt);
  if (!parsed.success) return false;
  const ageSeconds = nowSeconds - parsed.data;
  return ageSeconds >= -SESSION_CLOCK_SKEW_SECONDS && ageSeconds <= capSeconds;
}

// Access Control spec — Sign-in methods: master 1 h, admin and org-admin 4 h,
// everyone else 8 h.
export function sessionCapSeconds({
  roles,
  authMethod,
}: {
  roles: readonly string[];
  authMethod: string;
}): number {
  if (authMethod === "master") return 60 * 60;
  if (
    roles.includes("internal-admin") ||
    roles.includes("internal-org-admin")
  ) {
    return 4 * 60 * 60;
  }
  return SESSION_MAX_AGE_SECONDS;
}
