import { expect, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// docs/specs/2026-05-15-system-architecture.md -- "Configuration file" (Locked
// settings: the effective value, a "Set in config.yaml" badge and disabled
// controls; A6, A9: Playwright passes a fixture through APP_CONFIG_FILE),
// implementation-phases CFG Verify ("one headless e2e spec with a fixture file
// shows the locked setting"), Access Control T37.
//
// The e2e web server (playwright.config.ts) starts with
// APP_CONFIG_FILE=test/fixtures/config/e2e.yaml, which sets deleteKey and
// rotateKey to enabled:false (resetMemberSpend is not locked; see the fixture's
// header). The toggles API is real here (no
// page.route for it): the lock comes from the server reading the file. Only
// the connection read is stubbed, as in the other LiteLLM Settings specs.
test.describe("Settings -> LiteLLM -> Guardrails with a config.yaml (unit CFG)", () => {
  test.beforeEach(async ({ context, page }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await page.route(/\/api\/litellm\/connection$/, (route) =>
      route.fulfill({
        json: {
          data: {
            baseUrl: "https://litellm.example.internal",
            version: 1,
            edition: "oss",
            serviceKeyConfigured: true,
          },
        },
      }),
    );
    await page.goto("/dashboard/settings/litellm");
    await waitForHydration(page);
    await page.getByRole("tab", { name: "Guardrails" }).click();
  });

  test("an operation the file sets shows 'Set in config.yaml' and a disabled switch", async ({
    page,
  }) => {
    for (const name of ["rotateKey", "deleteKey"]) {
      const sw = page.getByRole("switch", { name });
      await expect(sw).toBeDisabled();
      await expect(sw).not.toBeChecked();
      await expect(page.getByTestId(`litellm-op-source-${name}`)).toHaveText(
        "Set in config.yaml",
      );
    }
  });

  test("an operation the file does not set stays editable", async ({
    page,
  }) => {
    const sw = page.getByRole("switch", { name: "createTeam" });
    await expect(sw).toBeEnabled();
    await expect(sw).toBeChecked();
    await expect(
      page.getByTestId("litellm-op-source-createTeam"),
    ).not.toHaveText(/config\.yaml/i);
  });

  // Design System - Navigation (Sidebar), Brand bullet, T-FX11: e2e.yaml still
  // sets display.orgName (accepted and ignored, D-F-13), the file loads, and
  // the sidebar brand shows the product name only.
  test("display.orgName in the file is ignored: the brand shows the product name only (T-FX11)", async ({
    page,
  }) => {
    const sidebar = page.locator('[data-slot="sidebar"]');
    await expect(sidebar.getByText("LLM Usage Lens").first()).toBeVisible();
    await expect(sidebar.getByText("E2E Config Org")).toHaveCount(0);
    await expect(sidebar.getByText(/organi[sz]ation/i)).toHaveCount(0);
  });
});
