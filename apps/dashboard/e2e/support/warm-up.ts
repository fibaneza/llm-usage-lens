import { chromium, expect } from "@playwright/test";

import { E2E_BASE_URL, E2E_PROBE_BASE_URL } from "./constants";
import { signInAsTestUser } from "./session";

// Playwright globalSetup for the CI e2e-dev job only (devServerWarmUp gate in
// playwright.config.ts). Web servers are up before globalSetup runs, so the
// cold `next dev` compiles /sign-in (with its server actions) and /dashboard
// here instead of inside the first test (.github/ACTIONS.md — e2e-dev job).
const WARM_UP_TIMEOUT = 120_000;

export default async function warmUp(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const base of [E2E_BASE_URL, E2E_PROBE_BASE_URL]) {
      await page.goto(`${base}/sign-in`, { timeout: WARM_UP_TIMEOUT });
      await expect(page.getByRole("button").first()).toBeVisible({
        timeout: WARM_UP_TIMEOUT,
      });
    }
    await signInAsTestUser(context);
    await page.goto(`${E2E_BASE_URL}/dashboard`, { timeout: WARM_UP_TIMEOUT });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: WARM_UP_TIMEOUT,
    });
  } finally {
    await browser.close();
  }
}
