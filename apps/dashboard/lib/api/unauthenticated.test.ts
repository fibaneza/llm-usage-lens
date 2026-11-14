import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: () => Promise.resolve(null) }));

import { withRoute } from "@/lib/api/respond";
import { unauthenticatedResponse } from "@/lib/api/unauthenticated";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes" (401
// UNAUTHORIZED); Rule 10.3, Rule 50.4; Access Control spec — Enforcement item
// 4. The proxy (auth.ts `authorized`) and withRoute answer a missing session
// with one shared 401, so the two cannot drift (4R.4 follow-up from
// fix/api-unauthenticated-401).
describe("unauthenticatedResponse", () => {
  it("is the no-store JSON 401 the API contract names", async () => {
    const res = unauthenticatedResponse();
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(res.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Not authenticated" },
    });
  });

  it("matches the 401 withRoute returns without a session", async () => {
    const route = withRoute(() => Promise.resolve(new Response("unreached")));
    const fromRoute = await route(new Request("http://localhost/api/x"), {
      params: Promise.resolve({}),
    });
    const fromProxy = unauthenticatedResponse();
    expect(fromRoute.status).toBe(fromProxy.status);
    expect(fromRoute.headers.get("Cache-Control")).toBe(
      fromProxy.headers.get("Cache-Control"),
    );
    expect(await fromRoute.json()).toEqual(await fromProxy.json());
  });
});
