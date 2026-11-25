import { expect, type Page, type Request, test } from "@playwright/test";

import { expectNoBlockingViolations } from "./support/axe";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System - Caching Strategy, Refresh (T-RF1, T-RF2) and
// Component Inventory - RefreshButton (top-bar icon button for every signed-in
// caller; a click reloads the data; the sync-status request carries
// Cache-Control: no-cache and exists only for a caller who sees the sync
// status); axe at 375px and desktop per the project standard
// (accessibility.spec.ts: WCAG 2 A/AA, serious or critical). Component and
// route behaviour is proved in RefreshButton.test.tsx and the sync-status
// route test (Rule 60.24a); this adds what only the real shell shows.
const BUTTON = { name: "Refresh data" };
const SYNC_STATUS = /\/api\/sync-status(\?|$)/;

function record(page: Page) {
  const requests: Request[] = [];
  page.on("request", (r) => requests.push(r));
  return requests;
}

test.describe("refresh button - global reader (sees the sync status)", () => {
  test("is in the top bar, a click sends no-cache sync-status requests and reloads the data", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await page.goto("/dashboard");
    await waitForHydration(page);
    const button = page.getByRole("button", BUTTON);
    await expect(button).toBeVisible();

    const requests = record(page);
    await button.click();

    // U-W4: at least one sync-status request, each with no-cache (no exact count).
    await expect
      .poll(() => requests.filter((r) => SYNC_STATUS.test(r.url())).length)
      .toBeGreaterThanOrEqual(1);
    for (const sync of requests.filter((r) => SYNC_STATUS.test(r.url()))) {
      expect(sync.headers()["cache-control"]).toContain("no-cache");
    }
    await expect
      .poll(
        () =>
          requests.filter(
            (r) => r.url().includes("/api/") && !SYNC_STATUS.test(r.url()),
          ).length,
      )
      .toBeGreaterThan(0);
  });

  // U-W2 (Design System - Caching Strategy, Refresh, T-RF2; WCAG 2.4.3, 4.1.3).
  test("keyboard: Enter refreshes, focus stays on the button, it is aria-busy and aria-disabled during the fetch, the status text appears (U-W2)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await page.goto("/dashboard");
    await waitForHydration(page);
    // Hold the sync-status response until the busy assertions are done, so the
    // busy period cannot end before they run (no wall-clock delay).
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let routeHits = 0;
    await page.route(SYNC_STATUS, async (route) => {
      routeHits += 1;
      await gate;
      await route.continue();
    });
    const button = page.getByRole("button", BUTTON);
    // The button ignores a press while page queries are still loading (busy),
    // so start from idle: the press must be the one that begins the refresh.
    await expect(button).not.toHaveAttribute("aria-busy", "true");
    await button.focus();
    await page.keyboard.press("Enter");

    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button).toBeFocused();
    await expect(
      page.getByRole("status").filter({ hasText: "Refreshing…" }),
    ).toBeAttached();
    expect(routeHits).toBeGreaterThan(0);
    release();

    await expect(button).not.toHaveAttribute("aria-busy", "true");
    await expect(button).toBeFocused();
    await expect(
      page.getByRole("status").filter({ hasText: "Updated" }),
    ).toBeAttached();
  });

  for (const width of [375, 1280]) {
    test(`axe clean at ${width}px`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 800 });
      await signInAsTestUser(context, { roles: ["internal-auditor"] });
      await page.goto("/dashboard");
      await waitForHydration(page);
      await expect(page.getByRole("button", BUTTON)).toBeVisible();
      await expectNoBlockingViolations(page);
    });
  }
});

// A caller with no global role and no sync status: the header is the same for
// a member and a viewer (scope.global false), so the viewer stands in for the
// member here (Design System - Component Inventory, RefreshButton).
test.describe("refresh button - internal-viewer, a non-global caller (no sync status)", () => {
  test("is in the top bar, a click reloads the page and sends no sync-status request", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await page.goto("/dashboard/me");
    await waitForHydration(page);
    const button = page.getByRole("button", BUTTON);
    await expect(button).toBeVisible();

    const requests = record(page);
    await button.click();

    await expect
      .poll(() => requests.some((r) => r.url().includes("_rsc")))
      .toBe(true);
    expect(requests.filter((r) => SYNC_STATUS.test(r.url()))).toHaveLength(0);
  });

  for (const width of [375, 1280]) {
    test(`axe clean at ${width}px`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 800 });
      await signInAsTestUser(context, { roles: ["internal-viewer"] });
      await page.goto("/dashboard/me");
      await waitForHydration(page);
      await expect(page.getByRole("button", BUTTON)).toBeVisible();
      await expectNoBlockingViolations(page);
    });
  }
});

// The lead case is in refresh-button-role-landing.spec.ts (the role-probe project).
