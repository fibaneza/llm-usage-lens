import { expect, test } from "@playwright/test";

import { signInAsPrefixedTestUser } from "./support/base-path-session";
import { E2E_BASE_PATH as P, E2E_PREFIX_ORIGIN } from "./support/constants";
import { buildSessionToken } from "./support/session";

// Source: docs/specs/2026-11-10-platform.md - Base path: BP-D9 (explicit Auth.js
// basePath <prefix>/api/auth, re-added by the route); docs/specs/2026-11-10-
// access-control.md - BP-D11 (pages.* and the redirect callback stay inside the
// prefix), BP-D8 / BP-D12 (every cookie Path=<prefix>, llm-lens.* names, never
// __Host-), threats T40 (cookie collision with the other application) and T41
// (open redirect out of the prefix or the host). Tests T6 to T8 of the BP
// brief against the real Auth.js on the production server; the pure logic and
// the auth.ts wiring are unit-tested (lib/auth/base-path-auth.test.ts,
// auth.base-path.test.ts). Prefixed project only; the sign-in itself needs the
// dev login, which production refuses, so the landing after sign-in is covered
// by the redirect-callback unit tests.
const AUTH = `${P}/api/auth`;

function setCookieLines(headers: { name: string; value: string }[]): string[] {
  return headers
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
}

test.describe("Auth.js under the prefix", () => {
  test("serves the session endpoint under the prefix only (BP-D9)", async ({
    request,
  }) => {
    expect((await request.get(`${AUTH}/session`)).status()).toBe(200);
    expect(
      (await request.get("/api/auth/session", { maxRedirects: 0 })).status(),
    ).toBe(404);
  });

  test("provider callback URLs stay inside the prefix (BP-D9, T41)", async ({
    request,
  }) => {
    const providers = (await (
      await request.get(`${AUTH}/providers`)
    ).json()) as Record<string, { callbackUrl: string }>;
    const urls = Object.values(providers).map((p) => p.callbackUrl);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      // NextURL rewrites loopback IPs to localhost, so assert path + loopback host.
      const parsed = new URL(url);
      expect(["localhost", "127.0.0.1"]).toContain(parsed.hostname);
      expect(parsed.port).toBe(new URL(E2E_PREFIX_ORIGIN).port);
      expect(parsed.pathname).toMatch(
        new RegExp(`^${P}/api/auth/callback/[^/]+$`),
      );
    }
  });

  test("the sign-in and error pages are inside the prefix (BP-D11)", async ({
    request,
  }) => {
    const pathOf = async (path: string) => {
      const res = await request.get(path, { maxRedirects: 0 });
      return new URL(res.headers()["location"] ?? "", E2E_PREFIX_ORIGIN)
        .pathname;
    };
    expect(await pathOf(`${AUTH}/signin`)).toBe(`${P}/sign-in`);
    expect(await pathOf(`${AUTH}/error?error=AccessDenied`)).toBe(
      `${P}/no-access`,
    );
  });
});

test.describe("cookies on a shared host (T40, BP-D8, BP-D12)", () => {
  test("every Set-Cookie has Path=<prefix>, an llm-lens.* name and no __Host-", async ({
    request,
  }) => {
    const res = await request.get(`${AUTH}/csrf`);
    const lines = setCookieLines(res.headersArray());
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const [pair = "", ...attrs] = line.split(";").map((p) => p.trim());
      const name = pair.slice(0, pair.indexOf("="));
      expect(attrs, line).toContain(`Path=${P}`);
      expect(name.replace(/^__Secure-/, ""), line).toMatch(/^llm-lens\./);
      expect(name.startsWith("__Host-"), line).toBe(false);
      expect(
        attrs.map((a) => a.toLowerCase()),
        line,
      ).toContain("httponly");
    }
  });

  test("the forged prefixed session cookie is accepted by the server (name and path match the auth config)", async ({
    context,
  }) => {
    await signInAsPrefixedTestUser(context);
    const res = await context.request.get(`${AUTH}/session`);
    const session = (await res.json()) as { user?: { email?: string } } | null;
    expect(session?.user?.email).toBe("e2e@example.test");
  });

  test("the other application's authjs.session-token cookie on Path=/ is not a session here", async ({
    context,
  }) => {
    const value = await buildSessionToken({ roles: ["internal-admin"] });
    await context.addCookies([
      {
        name: "authjs.session-token",
        value,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const res = await context.request.get(`${AUTH}/session`);
    const session = (await res.json()) as { user?: unknown } | null;
    expect(session?.user).toBeUndefined();
    const api = await context.request.get(`${P}/api/overview`, {
      maxRedirects: 0,
    });
    expect(api.status()).toBe(401);
  });
});

test.describe("redirects after sign-out stay inside the prefix (BP-D11, T41)", () => {
  async function signOutTo(
    request: import("@playwright/test").APIRequestContext,
    callbackUrl: string,
  ): Promise<URL> {
    const csrf = (await (await request.get(`${AUTH}/csrf`)).json()) as {
      csrfToken: string;
    };
    const res = await request.post(`${AUTH}/signout`, {
      form: { csrfToken: csrf.csrfToken, callbackUrl },
      maxRedirects: 0,
    });
    return new URL(res.headers()["location"] ?? "", E2E_PREFIX_ORIGIN);
  }

  test("a relative target lands on <prefix>/sign-in", async ({ request }) => {
    expect((await signOutTo(request, "/sign-in")).pathname).toBe(
      `${P}/sign-in`,
    );
  });

  for (const [label, target] of [
    [
      "the other application's path on this origin",
      `${E2E_PREFIX_ORIGIN}/other`,
    ],
    [
      "a sibling that starts with the prefix",
      `${E2E_PREFIX_ORIGIN}${P}-other/x`,
    ],
    ["another origin", "https://evil.test/"],
  ] as const) {
    test(`refuses ${label}`, async ({ request }) => {
      const location = await signOutTo(request, target);
      expect(location.origin).toBe(E2E_PREFIX_ORIGIN);
      expect(
        location.pathname === P || location.pathname.startsWith(`${P}/`),
      ).toBe(true);
    });
  }
});
