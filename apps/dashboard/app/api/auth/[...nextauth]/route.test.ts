// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// Source: docs/specs/2026-11-10-platform.md - Base path: BP-D9 (Route Handlers
// see request.url without the prefix, Auth.js matches its basePath
// <prefix>/api/auth against it, so this route re-adds the prefix to req.url
// before calling the handlers) and BP-D1 (no prefix: the request is passed
// through). Test of the BP brief (D9). The real Auth.js behaviour behind this
// route (callback URLs, redirects, cookies) is asserted in the prefixed
// Playwright project, e2e/base-path-auth.spec.ts: the unit project cannot load
// next-auth outside the Next bundler.
const handlers = vi.hoisted(() => ({
  GET: vi.fn<(req: Request) => Promise<Response>>(
    async () => new Response("get"),
  ),
  POST: vi.fn<(req: Request) => Promise<Response>>(
    async () => new Response("post"),
  ),
}));
vi.mock("@/auth", () => ({ handlers }));

const ORIGIN = "https://app.example.test";

async function loadRoute(prefix: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", prefix);
  return import("./route");
}

describe("/api/auth/[...nextauth] route (BP-D9)", () => {
  it.each(["GET", "POST"] as const)(
    "%s re-adds the prefix to the URL the Auth.js handler sees",
    async (method) => {
      const route = await loadRoute("/llm-lens");
      const res = await route[method](
        new NextRequest(`${ORIGIN}/api/auth/session?x=1`, { method }),
      );
      expect(res.status).toBe(200);
      const seen = handlers[method].mock.calls.at(-1)?.[0];
      expect(seen?.url).toBe(`${ORIGIN}/llm-lens/api/auth/session?x=1`);
      expect(seen?.method).toBe(method);
    },
  );

  it("forwards the POST body and headers", async () => {
    const route = await loadRoute("/llm-lens");
    await route.POST(
      new NextRequest(`${ORIGIN}/api/auth/signout`, {
        method: "POST",
        headers: {
          cookie: "a=b",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "csrfToken=t",
      }),
    );
    const seen = handlers.POST.mock.calls.at(-1)?.[0];
    expect(await seen?.text()).toBe("csrfToken=t");
    expect(seen?.headers.get("cookie")).toBe("a=b");
  });

  it.each(["GET", "POST"] as const)(
    "%s passes the URL through unchanged without a prefix (BP-D1)",
    async (method) => {
      const route = await loadRoute("");
      await route[method](
        new NextRequest(`${ORIGIN}/api/auth/session`, { method }),
      );
      expect(handlers[method].mock.calls.at(-1)?.[0].url).toBe(
        `${ORIGIN}/api/auth/session`,
      );
    },
  );
});
