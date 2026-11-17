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
// APP_CONFIG_FILE=test/fixtures/config/e2e.yaml, which sets resetMemberSpend,
// deleteKey and rotateKey to enabled:false. The toggles API is real here (no
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
    for (const name of ["rotateKey", "deleteKey", "resetMemberSpend"]) {
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

  // Review W2 (review-blockers.md): the loader-to-UI wiring. display.orgName in
  // e2e.yaml beats NEXT_PUBLIC_ORG_NAME (pinned to "Organization" by
  // playwright.config.ts) and reaches the top bar (A10).
  test("display.orgName from the file reaches the top bar", async ({
    page,
  }) => {
    await expect(page.getByText("E2E Config Org").first()).toBeVisible();
  });
});
