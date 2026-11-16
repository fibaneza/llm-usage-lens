import { expect, test } from "@playwright/test";

import { NAV_ITEMS } from "../lib/nav";
import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

test.describe("auth gate", () => {
  test("redirects unauthenticated visitors to /sign-in", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(
      page.getByRole("heading", { name: "LLM Usage Lens" }),
    ).toBeVisible();
  });
});

test.describe("dashboard shell", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  // Driven by lib/nav.ts so every page added to the sidebar is smoke-covered
  // automatically — a new nav route with a broken render fails here without
  // anyone remembering to add a spec.
  for (const item of NAV_ITEMS) {
    test(`${item.title} page renders without client errors`, async ({
      page,
    }) => {
      const pageErrors: Error[] = [];
      page.on("pageerror", (error) => pageErrors.push(error));
      // Any console.error fails the page (hydration mismatches, ErrorBoundary
      // fallbacks, failed fetches, key warnings) except allowlisted noise.
      const consoleErrors = collectConsoleErrors(page);

      await page.goto(item.href);
      await waitForHydration(page);

      // Still on the dashboard route — the forged session was accepted.
      // Settings (unit D) redirects its index to the first tab, so the URL
      // only has to stay under the nav item's route.
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === item.href ||
          url.pathname.startsWith(`${item.href}/`),
      );
      // PageTitle renders the route's single <h1> from the nav item.
      await expect(
        page.getByRole("heading", { level: 1, name: item.pageTitle }),
      ).toBeVisible();
      // Sidebar shell is present alongside the page content.
      await expect(
        page.getByRole("link", { name: item.title, exact: true }),
      ).toBeVisible();

      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  }
});
