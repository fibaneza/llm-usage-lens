import { expect, test } from "@playwright/test";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes" (401
// UNAUTHORIZED); Rule 10.3, Rule 50.4; Access Control spec — Enforcement
// (every /api/* response is private, no-store). The proxy answers a
// logged-out API call with the JSON 401 that withRoute returns, instead of a
// redirect to the sign-in page; pages keep the redirect, and /api/health stays
// public.
test.describe("unauthenticated requests through the proxy", () => {
  test("a cookie-less GET /api/overview gets a no-store JSON 401", async ({
    request,
  }) => {
    const response = await request.get("/api/overview", { maxRedirects: 0 });
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Not authenticated" },
    });
  });

  test("a cookie-less GET /dashboard still redirects to sign-in", async ({
    request,
  }) => {
    const response = await request.get("/dashboard", { maxRedirects: 0 });
    expect([302, 303, 307]).toContain(response.status());
    expect(response.headers()["location"]).toMatch(/\/sign-in(\?|$)/);
  });

  test("GET /api/health is still served without a session", async ({
    request,
  }) => {
    const response = await request.get("/api/health", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
  });
});
