// @vitest-environment node
import { describe, expect, it } from "vitest";

import { authCookies, resolveRedirect } from "./base-path-auth";

// Source: docs/specs/2026-11-10-access-control.md - BP-D8 and BP-D12 (cookie
// path and names under a prefix), BP-D11 (the custom redirect callback), threats
// T40 (cookies) and T41 (open redirect out of the prefix or the host). Tests
// T7 and T8 of the BP brief, the pure part; auth.test.ts checks the wiring and
// app/api/auth/[...nextauth]/route.test.ts the real Auth.js behaviour.
const PREFIX = "/llm-lens";
const BASE = "https://app.example.test";

const KEYS = {
  sessionToken: "session-token",
  callbackUrl: "callback-url",
  csrfToken: "csrf-token",
  pkceCodeVerifier: "pkce.code_verifier",
  state: "state",
  nonce: "nonce",
} as const;

describe("authCookies (BP-D8, BP-D12, T40)", () => {
  it.each([false, true])(
    "scopes every cookie to Path=<prefix> with an llm-lens.* name (secure=%s)",
    (secure) => {
      const cookies = authCookies(PREFIX, secure) as Record<
        string,
        {
          name: string;
          options: {
            path: string;
            httpOnly: boolean;
            sameSite: string;
            secure: boolean;
          };
        }
      >;
      for (const [key, suffix] of Object.entries(KEYS)) {
        const cookie = cookies[key];
        expect(cookie, key).toBeDefined();
        expect(cookie?.name, key).toBe(
          `${secure ? "__Secure-" : ""}llm-lens.${suffix}`,
        );
        expect(cookie?.options.path, key).toBe(PREFIX);
        expect(cookie?.options.httpOnly, key).toBe(true);
        expect(cookie?.options.sameSite, key).toBe("lax");
        expect(cookie?.options.secure, key).toBe(secure);
      }
    },
  );

  it("never uses a __Host- name, which requires Path=/", () => {
    const names = Object.values(
      authCookies(PREFIX, true) as Record<string, { name: string }>,
    ).map((c) => c.name);
    expect(names.length).toBe(Object.keys(KEYS).length);
    for (const name of names) expect(name.startsWith("__Host-")).toBe(false);
  });

  it("derives the path from the prefix it is given", () => {
    const cookies = authCookies("/a/b-2", false) as Record<
      string,
      { options: { path: string } }
    >;
    expect(cookies.sessionToken?.options.path).toBe("/a/b-2");
  });

  it.each([false, true])(
    "overrides nothing without a prefix, so the Auth.js defaults stay (secure=%s)",
    (secure) => {
      expect(authCookies("", secure)).toEqual({});
    },
  );
});

describe("resolveRedirect with a prefix (BP-D11, T41)", () => {
  it.each([
    ["/dashboard", `${BASE}/llm-lens/dashboard`],
    ["/sign-in", `${BASE}/llm-lens/sign-in`],
    ["/no-access", `${BASE}/llm-lens/no-access`],
    ["/llm-lens/dashboard", `${BASE}/llm-lens/dashboard`],
    [
      "/dashboard/settings/access/roles#role-grants",
      `${BASE}/llm-lens/dashboard/settings/access/roles#role-grants`,
    ],
    [
      "/dashboard/settings/access/sign-in#password-users",
      `${BASE}/llm-lens/dashboard/settings/access/sign-in#password-users`,
    ],
  ])("gives the relative URL %s the prefix once", (url, expected) => {
    expect(resolveRedirect(url, BASE, PREFIX)).toBe(expected);
  });

  it.each([
    `${BASE}/llm-lens/dashboard`,
    `${BASE}/llm-lens`,
    `${BASE}/llm-lens/api/auth/callback/dev?x=1`,
  ])("keeps the same-origin URL %s that is inside the prefix", (url) => {
    expect(resolveRedirect(url, BASE, PREFIX)).toBe(url);
  });

  it.each([
    ["the other application's path on this origin", `${BASE}/other`],
    ["a sibling that starts with the prefix", `${BASE}/llm-lens-other/x`],
    ["the root of this origin", `${BASE}/`],
    ["another origin, inside the prefix", "https://evil.test/llm-lens/x"],
    ["another origin", "https://evil.test/"],
    ["a lookalike host", "https://app.example.test.evil.test/llm-lens/x"],
    ["another scheme on this host", "http://app.example.test/llm-lens/x"],
    ["a javascript: URL", "javascript:alert(1)"],
  ])("refuses %s and lands on <prefix>/dashboard", (_name, url) => {
    expect(resolveRedirect(url, BASE, PREFIX)).toBe(
      `${BASE}/llm-lens/dashboard`,
    );
  });

  it.each([
    "//evil.test/llm-lens",
    "//evil.test",
    "/\\evil.test",
    "///evil.test",
    "/llm-lens/../other",
    "/llm-lens/%2e%2e/other",
  ])("never leaves the origin or the prefix for %s", (url) => {
    const target = new URL(resolveRedirect(url, BASE, PREFIX));
    expect(target.origin).toBe(BASE);
    expect(
      target.pathname === PREFIX || target.pathname.startsWith(`${PREFIX}/`),
    ).toBe(true);
  });
});

describe("resolveRedirect without a prefix (BP-D1: behaviour unchanged)", () => {
  it("resolves a relative URL against the base", () => {
    expect(resolveRedirect("/dashboard", BASE, "")).toBe(`${BASE}/dashboard`);
  });

  it("keeps a same-origin absolute URL", () => {
    expect(resolveRedirect(`${BASE}/dashboard`, BASE, "")).toBe(
      `${BASE}/dashboard`,
    );
  });

  it("refuses another origin", () => {
    const target = new URL(resolveRedirect("https://evil.test/x", BASE, ""));
    expect(target.origin).toBe(BASE);
  });
});
