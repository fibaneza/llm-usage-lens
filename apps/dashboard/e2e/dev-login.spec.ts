import { expect, test } from "@playwright/test";

// Runs against the E2E dev server, which sets AUTH_DEV_LOGIN=true and no Entra
// vars (playwright.config.ts). Auth guide — Dev-only local login.
test.describe("dev-only local login", () => {
  test("/sign-in offers only the local developer button", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(
      page.getByRole("button", { name: "Sign in as local developer" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in with Microsoft" }),
    ).toHaveCount(0);
  });

  test("signing in as the local developer lands on /dashboard", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page
      .getByRole("button", { name: "Sign in as local developer" })
      .click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Cost overview" }),
    ).toBeVisible();
  });
});
