import { chromium, expect, type Page } from "@playwright/test";

import { seedRoleProbe } from "../../test/fixtures/role-probe-seed";

import { waitForHydration } from "./hydration";
import { PROBE_PAGES } from "./probe-pages";
import { E2E_BASE_URL, E2E_PROBE_BASE_URL } from "./constants";
import { signInAsTestUser } from "./session";

// Playwright globalSetup for every `next dev` run (devServerWarmUp gate in
// playwright.config.ts; production servers never load it). Web servers are up
// before globalSetup runs, so the cold `next dev` compiles /sign-in (with its
// server actions), /dashboard and the role-probe pages here instead of inside
// the first tests (.github/ACTIONS.md — e2e-dev job). Cold on-demand
// compilation (about 3 s a route) made role-landing:232 and settings-tabs:129
// fail on 2026-11-24 (docs/guides/testing.md — E2E dev-server warm-up).
const WARM_UP_TIMEOUT = 120_000;

// Fails loudly on a server error or the dev error overlay; a 404 is fine.
async function visit(page: Page, url: string): Promise<void> {
  const response = await page.goto(url, {
    timeout: WARM_UP_TIMEOUT,
    waitUntil: "load",
  });
  const status = response?.status() ?? 0;
  if (status >= 500) throw new Error(`warm-up: ${url} returned ${status}`);
  await assertNoDevError(page, url);
}

async function assertNoDevError(page: Page, where: string): Promise<void> {
  const body = (await page.locator("body").innerText()).toLowerCase();
  if (
    body.includes("unexpected turbopack error") ||
    (await page.locator("[data-nextjs-dialog-overlay]").count()) > 0
  ) {
    throw new Error(`warm-up: Next error overlay at ${where}`);
  }
}

// The in-page (RSC) navigations the role-probe specs do, which a page load
// does not compile: Settings -> Access tab and each sub-tab, every sidebar link.
async function warmInPageNavigation(page: Page): Promise<void> {
  const wait = { timeout: WARM_UP_TIMEOUT };
  await visit(page, `${E2E_PROBE_BASE_URL}/dashboard/settings/accounts`);
  await waitForHydration(page);
  await page.getByRole("tab", { name: "Access" }).click(wait);
  await page.waitForURL(/\/settings\/access\/people/, wait);
  const sub = page.getByRole("tablist", { name: "Access sections" });
  for (const name of await sub.getByRole("tab").allTextContents()) {
    await sub.getByRole("tab", { name: name.trim() }).click(wait);
    await page.waitForLoadState("load", wait);
    await assertNoDevError(page, `Access tab ${name.trim()}`);
  }

  const nav = page.getByRole("navigation", { name: "Primary" });
  const hrefs = await nav
    .getByRole("link")
    .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  for (const href of hrefs) {
    await nav.locator(`a[href="${href}"]`).click(wait);
    await page.waitForURL(
      (u) =>
        u.pathname === href ||
        (href !== "/dashboard" && u.pathname.startsWith(`${href}/`)),
      wait,
    );
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible(wait);
    await assertNoDevError(page, `sidebar link ${href}`);
  }
}

export default async function warmUp(): Promise<void> {
  await seedRoleProbe();
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

    const probeContext = await browser.newContext();
    await signInAsTestUser(probeContext, {
      roles: ["internal-admin"],
      oid: "r5-admin",
    });
    const probePage = await probeContext.newPage();
    for (const path of PROBE_PAGES) {
      await visit(probePage, `${E2E_PROBE_BASE_URL}${path}`);
    }
    await warmInPageNavigation(probePage);
  } finally {
    await browser.close();
  }
}
