import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authCookies } from "@/lib/auth/base-path-auth";

// Source: docs/specs/2026-11-10-platform.md - Base path: BP-D9 (explicit
// Auth.js basePath <prefix>/api/auth); docs/specs/2026-11-10-access-control.md
// - BP-D10 (authorized strips the prefix, explicit prefixed redirect, JSON 401
// for API), BP-D11 (custom redirect callback, pages.* prefixed), BP-D12 and
// BP-D8 (cookies), threats T40, T41, T43. Tests T6, T7 and T8 of the BP brief,
// the auth.ts wiring. Auth.js is mocked as in auth.test.ts: the config auth.ts
// passes to NextAuth() is captured; the pure pieces are in
// lib/auth/base-path-auth.test.ts and the real Auth.js behaviour in
// app/api/auth/[...nextauth]/route.test.ts.
const captured = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    captured.config = config;
    return {
      handlers: {},
      auth: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: unknown) => ({ type: "credentials", options }),
}));
vi.mock("next-auth/providers/microsoft-entra-id", () => ({
  default: { type: "oidc", id: "microsoft-entra-id" },
}));

const ORIGIN = "https://app.example.test";

type AuthorizedParams = { auth: unknown; request: NextRequest };
type Config = {
  basePath?: string;
  pages?: { signIn?: string; error?: string };
  cookies?: unknown;
  callbacks: {
    authorized: (p: AuthorizedParams) => boolean | Response | Promise<unknown>;
    redirect: (p: { url: string; baseUrl: string }) => string | Promise<string>;
  };
};

async function loadConfig(env: Record<string, string>): Promise<Config> {
  vi.resetModules();
  const vars: Record<string, string> = {
    SKIP_ENV_VALIDATION: "1",
    AUTH_SECRET: "test-secret",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NODE_ENV: "development",
    NEXT_PHASE: "",
    APP_ENV: "dev",
    AUTH_DEV_LOGIN: "true",
    AUTH_MICROSOFT_ENTRA_ID_ID: "",
    AUTH_MICROSOFT_ENTRA_ID_SECRET: "",
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: "",
    AUTH_URL: "",
    NEXT_PUBLIC_BASE_PATH: "",
    ...env,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  // t3-env treats a defined `window` as the browser; hide it as auth.test.ts does.
  vi.stubGlobal("window", undefined);
  await import("@/auth");
  return captured.config as Config;
}

const PREFIXED = { NEXT_PUBLIC_BASE_PATH: "/llm-lens", AUTH_URL: ORIGIN };
const signedOut = { auth: null };
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

function asResponse(value: unknown): Response {
  expect(value).toBeInstanceOf(Response);
  return value as Response;
}

beforeEach(() => {
  captured.config = undefined;
});

describe("auth.ts Auth.js basePath and pages (BP-D9, BP-D11)", () => {
  it("sets the Auth.js basePath to <prefix>/api/auth", async () => {
    expect((await loadConfig(PREFIXED)).basePath).toBe("/llm-lens/api/auth");
  });

  it("prefixes pages.signIn and pages.error", async () => {
    const { pages } = await loadConfig(PREFIXED);
    expect(pages?.signIn).toBe("/llm-lens/sign-in");
    expect(pages?.error).toBe("/llm-lens/no-access");
  });

  it("keeps the defaults without a prefix (BP-D1)", async () => {
    const config = await loadConfig({});
    expect([undefined, "/api/auth"]).toContain(config.basePath);
    expect(config.pages).toMatchObject({
      signIn: "/sign-in",
      error: "/no-access",
    });
  });
});

describe("auth.ts redirect callback (BP-D11, T41)", () => {
  it.each([
    ["/dashboard", `${ORIGIN}/llm-lens/dashboard`],
    ["/sign-in", `${ORIGIN}/llm-lens/sign-in`],
    [
      "/dashboard/settings/access/roles#role-grants",
      `${ORIGIN}/llm-lens/dashboard/settings/access/roles#role-grants`,
    ],
    [`${ORIGIN}/llm-lens/dashboard`, `${ORIGIN}/llm-lens/dashboard`],
    // Refused: the other application's path, a sibling, another origin.
    [`${ORIGIN}/other`, `${ORIGIN}/llm-lens/dashboard`],
    [`${ORIGIN}/llm-lens-other/x`, `${ORIGIN}/llm-lens/dashboard`],
    ["https://evil.test/llm-lens/x", `${ORIGIN}/llm-lens/dashboard`],
  ])("redirects %s to %s", async (url, expected) => {
    const { callbacks } = await loadConfig(PREFIXED);
    expect(await callbacks.redirect({ url, baseUrl: ORIGIN })).toBe(expected);
  });

  it("without a prefix, resolves a relative URL against the base as before", async () => {
    const { callbacks } = await loadConfig({ AUTH_URL: ORIGIN });
    expect(
      await callbacks.redirect({ url: "/dashboard", baseUrl: ORIGIN }),
    ).toBe(`${ORIGIN}/dashboard`);
  });
});

describe("auth.ts authorized under a prefix (BP-D10, T43)", () => {
  // With AUTH_URL set, next-auth rebuilds the request without Next's config:
  // pathname carries the prefix and basePath is "". Without AUTH_URL the
  // pathname has no prefix. Both shapes must give the same answers.
  const API = [`${ORIGIN}/llm-lens/api/echo`, `${ORIGIN}/api/echo`] as const;
  const PAGES = [
    `${ORIGIN}/llm-lens/dashboard`,
    `${ORIGIN}/dashboard/settings`,
  ] as const;

  it("lets a signed-in user through", async () => {
    const { callbacks } = await loadConfig(PREFIXED);
    const request = new NextRequest(API[0]);
    expect(
      await callbacks.authorized({
        auth: { user: { oid: "u1" } },
        request,
      }),
    ).toBe(true);
  });

  it.each(API)(
    "answers an unauthenticated API call %s with the JSON 401",
    async (url) => {
      const { callbacks } = await loadConfig(PREFIXED);
      const res = asResponse(
        await callbacks.authorized({
          ...signedOut,
          request: new NextRequest(url),
        }),
      );
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(await res.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      });
    },
  );

  it.each(PAGES)(
    "redirects an unauthenticated page %s to <prefix>/sign-in",
    async (url) => {
      const { callbacks } = await loadConfig(PREFIXED);
      const res = asResponse(
        await callbacks.authorized({
          ...signedOut,
          request: new NextRequest(url),
        }),
      );
      expect(REDIRECT_STATUSES).toContain(res.status);
      const location = new URL(res.headers.get("location") ?? "", ORIGIN);
      expect(location.origin).toBe(ORIGIN);
      expect(location.pathname).toBe("/llm-lens/sign-in");
    },
  );

  it("without a prefix an unauthenticated page is still refused with false and an API call gets the 401 (BP-D1)", async () => {
    const { callbacks } = await loadConfig({ AUTH_URL: ORIGIN });
    expect(
      await callbacks.authorized({
        ...signedOut,
        request: new NextRequest(`${ORIGIN}/dashboard`),
      }),
    ).toBe(false);
    const res = asResponse(
      await callbacks.authorized({
        ...signedOut,
        request: new NextRequest(`${ORIGIN}/api/echo`),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("auth.ts cookies (BP-D8, BP-D12, T40)", () => {
  it("scopes cookies to the prefix, with __Secure- names when AUTH_URL is https", async () => {
    const { cookies } = await loadConfig(PREFIXED);
    expect(cookies).toEqual(authCookies("/llm-lens", true));
  });

  it("uses plain names when AUTH_URL is http", async () => {
    const { cookies } = await loadConfig({
      NEXT_PUBLIC_BASE_PATH: "/llm-lens",
      AUTH_URL: "http://127.0.0.1:3214",
    });
    expect(cookies).toEqual(authCookies("/llm-lens", false));
  });

  it("uses plain names when AUTH_URL is unset", async () => {
    const { cookies } = await loadConfig({
      NEXT_PUBLIC_BASE_PATH: "/llm-lens",
    });
    expect(cookies).toEqual(authCookies("/llm-lens", false));
  });

  it("leaves the Auth.js cookie defaults alone without a prefix", async () => {
    const { cookies } = await loadConfig({ AUTH_URL: ORIGIN });
    expect(
      cookies === undefined || Object.keys(cookies as object).length === 0,
    ).toBe(true);
  });
});
