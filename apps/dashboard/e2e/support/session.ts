import type { BrowserContext } from "@playwright/test";
import { encode } from "next-auth/jwt";

import { E2E_AUTH_SECRET, E2E_BASE_URL } from "./constants";

// Auth.js v5 session cookie on plain http (the E2E dev server); the salt must
// equal the cookie name for decode() in proxy.ts to accept the token.
const SESSION_COOKIE = "authjs.session-token";

export const E2E_USER = {
  name: "E2E Test User",
  email: "e2e@example.test",
};

// Default forged role: `internal-auditor`, the least-privileged global role that
// reads every usage page (Access Control spec - Roles: "Everything, read-only";
// writes return 403). `internal-viewer`/[] is membership-gated and lands on
// My usage, so it would break every page-level spec. Coordinator ruling
// 2026-11-16 (4R.5 review UI-B1).
export const DEFAULT_TEST_ROLES: readonly string[] = ["internal-auditor"];

export type TestUserOptions = {
  // Epoch seconds of the forged sign-in. Defaults to now. `null` omits the
  // claim, which the dev server's jwt callback must reject (a token without a
  // sign-in time fails closed; System Architecture — Account-mutation role).
  signedInAt?: number | null;
  // Role claims carried in the forged token (`token.roles`, mapped to
  // `session.user.roles` by auth.ts). Defaults to DEFAULT_TEST_ROLES, a global
  // read-only reader that sees every usage page. Pass `roles: []` (or
  // `["internal-viewer"]`) explicitly for the no-team viewer, who is redirected
  // to /dashboard/me and gets a trimmed sidebar (Phase 4R.5).
  roles?: string[];
  // Epoch seconds of the last full sign-in (`token.authTime`, Access Control
  // spec - Recent authentication). Defaults to none; a value older than 15
  // minutes is a stale session whose re-auth writes answer REAUTH_REQUIRED.
  authTime?: number;
  oid?: string;
  tid?: string;
  authMethod?: "entra" | "master" | "local";
};

// Encodes the Auth.js session JWT for a forged test sign-in (the same token
// signInAsTestUser plants as a cookie). Shared with the L5 probe's setup, which
// signs requests outside a browser context.
export async function buildSessionToken({
  signedInAt = Math.floor(Date.now() / 1000),
  roles = [...DEFAULT_TEST_ROLES],
  authTime,
  oid = "e2e-user",
  tid = "e2e-tenant",
  authMethod = "entra",
}: TestUserOptions = {}): Promise<string> {
  return encode({
    token: {
      ...E2E_USER,
      sub: "e2e-user",
      oid,
      tid,
      authMethod,
      roles,
      ...(authTime === undefined ? {} : { authTime }),
      ...(signedInAt === null ? {} : { signedInAt }),
    },
    secret: E2E_AUTH_SECRET,
    salt: SESSION_COOKIE,
  });
}

// Signs a real Auth.js session JWT with the dev server's AUTH_SECRET and
// plants it as a cookie. This is not an auth bypass: proxy.ts and the
// authorized() callback verify the token exactly as in production — only the
// Entra ID round-trip is skipped (auth-setup guide; Rule 50.4 still holds).
// The token carries `signedInAt` because sessions end 8 hours after sign-in
// regardless of activity and a token without it is rejected.
export async function signInAsTestUser(
  context: BrowserContext,
  options: TestUserOptions = {},
): Promise<void> {
  const sessionToken = await buildSessionToken(options);

  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: sessionToken,
      url: E2E_BASE_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
