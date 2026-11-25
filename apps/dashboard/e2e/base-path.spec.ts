import { expect, test } from "@playwright/test";

import { E2E_BASE_PATH as P } from "./support/constants";
import { collectConsoleErrors } from "./support/console-errors";
import { signInAsPrefixedTestUser } from "./support/base-path-session";
import { waitForHydration } from "./support/hydration";

// Source: docs/specs/2026-11-10-platform.md - Base path: BP-D1 (served under
// the prefix), BP-D5 (health moves with the app; /api/health is 404), BP-D3
// (links and fetches carry the prefix), Runtime (response security headers,
// no-store); docs/specs/2026-11-10-access-control.md - BP-D10 / T43 (API 401
// JSON, page redirect inside the prefix), T40 (path-scoped session cookie).
// Runs only in the prefixed project (playwright.config.ts: port 3214, built
// with NEXT_PUBLIC_BASE_PATH=/llm-lens). Every URL is explicit: a baseURL with
// a path does not prefix goto("/dashboard"). Tests T9 to T11 of the BP brief.
test.describe("only the prefix answers (T9, BP-D5)", () => {
  test("GET <prefix>/api/health is 200 with no session", async ({
    request,
  }) => {
    const response = await request.get(`${P}/api/health`);
    expect(response.status()).toBe(200);
  });

  for (const path of [
    "/api/health",
    "/dashboard",
    "/",
    "/sign-in",
    "/llm-lens-other/api/health",
  ]) {
    test(`GET ${path} outside the prefix is 404`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(404);
    });
  }
});

test.describe("headers on prefixed responses (T10)", () => {
  const SECURITY = {
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "content-security-policy": "frame-ancestors 'none'",
  };

  test("an API response is no-store and carries the security headers", async ({
    request,
  }) => {
    const response = await request.get(`${P}/api/health`);
    const headers = response.headers();
    expect(headers["cache-control"]).toBe("private, no-store");
    for (const [key, value] of Object.entries(SECURITY)) {
      expect(headers[key], key).toBe(value);
    }
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("a page response carries the security headers", async ({ page }) => {
    const response = await page.goto(`${P}/sign-in`);
    const headers = response?.headers() ?? {};
    for (const [key, value] of Object.entries(SECURITY)) {
      expect(headers[key], key).toBe(value);
    }
  });

  test("an unauthenticated API call gets the JSON 401, no redirect (T43)", async ({
    request,
  }) => {
    const response = await request.get(`${P}/api/overview`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Not authenticated" },
    });
  });

  test("an unauthenticated page redirects to <prefix>/sign-in (T43)", async ({
    request,
  }) => {
    const response = await request.get(`${P}/dashboard`, { maxRedirects: 0 });
    expect([302, 303, 307]).toContain(response.status());
    const location = new URL(
      response.headers()["location"] ?? "",
      "http://127.0.0.1",
    );
    expect(location.pathname).toBe(`${P}/sign-in`);
  });
});

test.describe("prefixed smoke (T11)", () => {
  test("home page, sign-in link, then a signed-in session end to end", async ({
    context,
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const consoleErrors = collectConsoleErrors(page);
    const apiCalls: { url: string; status: number }[] = [];
    page.on("response", (response) => {
      const { pathname } = new URL(response.url());
      if (pathname.includes("/api/")) {
        apiCalls.push({ url: pathname, status: response.status() });
      }
    });

    // Open <prefix>: the public home page; its sign-in link stays inside.
    await page.goto(P);
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `${P}/sign-in`,
    );

    // Signed in with a forged session whose cookie is Path=<prefix>.
    await signInAsPrefixedTestUser(context, { roles: ["internal-admin"] });
    await page.goto(`${P}/dashboard`);
    await waitForHydration(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "Cost overview" }),
    ).toBeVisible();
    // The landing page loads its data through the prefixed API.
    await expect
      .poll(() => apiCalls.filter((c) => c.status === 200).length)
      .toBeGreaterThan(0);
    for (const call of apiCalls) {
      expect(call.url.startsWith(`${P}/api/`), call.url).toBe(true);
    }

    // One sidebar link (next/link adds the prefix).
    await page.getByRole("link", { name: "Cost by team", exact: true }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === `${P}/dashboard/teams`,
    );

    // One Settings tab.
    await page.goto(`${P}/dashboard/settings`);
    await waitForHydration(page);
    await page.getByRole("tab", { name: "Access" }).click();
    await expect(page).toHaveURL((url) =>
      url.pathname.startsWith(`${P}/dashboard/settings/access`),
    );

    // The access-review download link carries the prefix and works with the
    // path-scoped session cookie.
    await page.goto(`${P}/dashboard/manage/audit`);
    await waitForHydration(page);
    const download = page
      .getByRole("region", { name: "Access review" })
      .getByRole("link", { name: /export access review/i });
    await expect(download).toHaveAttribute("href", `${P}/api/access-review`);
    const csv = await page.request.get(`${P}/api/access-review`);
    expect(csv.status()).toBe(200);

    // Sign out lands on <prefix>/sign-in.
    await page.getByRole("button", { name: "Open user menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL((url) => url.pathname === `${P}/sign-in`);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
