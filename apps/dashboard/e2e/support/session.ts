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

// Signs a real Auth.js session JWT with the dev server's AUTH_SECRET and
// plants it as a cookie. This is not an auth bypass: proxy.ts and the
// authorized() callback verify the token exactly as in production — only the
// Entra ID round-trip is skipped (auth-setup guide; Rule 50.4 still holds).
export async function signInAsTestUser(context: BrowserContext): Promise<void> {
  const sessionToken = await encode({
    token: { ...E2E_USER, sub: "e2e-user" },
    secret: E2E_AUTH_SECRET,
    salt: SESSION_COOKIE,
  });

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
