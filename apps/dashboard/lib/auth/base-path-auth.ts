import { withBasePath } from "@/lib/base-path";

// Access Control spec - BP-D8, BP-D11, BP-D12, T40, T41. Pure pieces of the
// Auth.js wiring under a base path; no Auth.js import.
const COOKIE_KEYS = {
  sessionToken: "session-token",
  callbackUrl: "callback-url",
  csrfToken: "csrf-token",
  pkceCodeVerifier: "pkce.code_verifier",
  state: "state",
  nonce: "nonce",
} as const;

type CookieConfig = {
  name: string;
  options: {
    path: string;
    httpOnly: true;
    sameSite: "lax";
    secure: boolean;
  };
};

// With a prefix every cookie gets Path=<prefix> and an app-specific name, never
// __Host- (it requires Path=/). Without one the Auth.js defaults stay.
export function authCookies(
  prefix: string,
  secure: boolean,
): Record<string, CookieConfig> {
  if (prefix === "") return {};
  return Object.fromEntries(
    Object.entries(COOKIE_KEYS).map(([key, suffix]) => [
      key,
      {
        name: `${secure ? "__Secure-" : ""}llm-lens.${suffix}`,
        options: { path: prefix, httpOnly: true, sameSite: "lax", secure },
      },
    ]),
  );
}

// Auth.js `redirect` callback. Same origin only; with a prefix, only inside it.
export function resolveRedirect(
  url: string,
  baseUrl: string,
  prefix: string,
): string {
  const base = new URL(baseUrl);
  const fallback = `${base.origin}${prefix}/dashboard`;
  let target: URL;
  try {
    target = new URL(withBasePath(url, prefix), base);
  } catch {
    return fallback;
  }
  if (target.origin !== base.origin) return fallback;
  if (
    prefix !== "" &&
    target.pathname !== prefix &&
    !target.pathname.startsWith(`${prefix}/`)
  ) {
    return fallback;
  }
  return target.href;
}
