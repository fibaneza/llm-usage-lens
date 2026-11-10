import { expect, test } from "@playwright/test";

import { signInAsTestUser } from "./support/session";

// Source: docs/specs/2026-11-10-platform.md — Runtime, "Response security
// headers" (security review 2026-11-11, M1): every response carries
// X-Frame-Options: DENY and X-Content-Type-Options: nosniff, and X-Powered-By
// is off. Exact header values are covered by next.config.test.ts; this proves
// they reach the real server for a page and an API route.
test.describe("response security headers", () => {
  test("a dashboard page response carries them", async ({ context, page }) => {
    await signInAsTestUser(context);
    const response = await page.goto("/dashboard");
    expect(response).not.toBeNull();
    const headers = response?.headers() ?? {};
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("the public sign-in page response carries them", async ({ page }) => {
    const response = await page.goto("/sign-in");
    const headers = response?.headers() ?? {};
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("GET /api/health carries them and is no-store", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-powered-by"]).toBeUndefined();
    expect(headers["cache-control"]).toBe("private, no-store");
  });
});
