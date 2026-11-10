import { expect, test } from "@playwright/test";

// Contract R1 decision 9: /no-access is reachable without a session (outside
// /dashboard) and shows the fail-closed message.
test.describe("/no-access", () => {
  test("is reachable without a session and explains the denial", async ({
    page,
  }) => {
    await page.goto("/no-access");
    await expect(page).toHaveURL(/\/no-access/);
    await expect(
      page.getByText(
        "You don't have access to LLM Usage Lens. Contact your administrator.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /sign (in|out)/i }),
    ).toBeVisible();
  });
});
