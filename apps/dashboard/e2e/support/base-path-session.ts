import type { BrowserContext } from "@playwright/test";

import { E2E_BASE_PATH } from "./constants";
import { buildSessionToken, type TestUserOptions } from "./session";

// Unit BP (Access Control spec - BP-D12, T40): under a prefix the session
// cookie has an app-specific name and `Path=<prefix>`. Name and path come from
// the same module as the auth config (lib/auth/base-path-auth.ts), so the forge
// and the server cannot drift. The prefixed e2e server is plain http (AUTH_URL
// is http://127.0.0.1:3214), so the names carry no __Secure- prefix. The module
// is imported lazily so specs that never forge a prefixed session load without it.
type CookieSpec = { name: string; options: { path: string } };

export async function prefixedSessionCookie(): Promise<{
  name: string;
  path: string;
}> {
  const { authCookies } = await import("../../lib/auth/base-path-auth");
  const cookies = authCookies(E2E_BASE_PATH, false) as Record<
    string,
    CookieSpec
  >;
  const session = cookies.sessionToken;
  if (!session) throw new Error("authCookies must define sessionToken");
  return { name: session.name, path: session.options.path };
}

// `addCookies({ url })` takes the directory of the URL path, which would turn
// Path=/llm-lens into Path=/ (testing guide - Prefixed e2e project); so the
// cookie is added with `domain` and `path`.
export async function signInAsPrefixedTestUser(
  context: BrowserContext,
  options: TestUserOptions = {},
): Promise<void> {
  const { name, path } = await prefixedSessionCookie();
  const value = await buildSessionToken(options, name);
  await context.addCookies([
    {
      name,
      value,
      domain: "127.0.0.1",
      path,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
