import { expect, test } from "@playwright/test";

import { NAV_ITEMS } from "../lib/nav";
import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// The design-system breakpoints (Rule 40.6). Heights are incidental — the
// checks below are about horizontal behaviour.
const BREAKPOINTS = [
  { label: "mobile", width: 375, height: 812 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "laptop", width: 1024, height: 768 },
  { label: "desktop", width: 1440, height: 900 },
] as const;

// Smoke-level responsive gate: no page may scroll horizontally at any
// breakpoint (implementation-phases spec — Phase 5 "Responsive testing").
// Chart resizing and touch-target sizes remain Phase 5 checks.
test.describe("responsive breakpoints", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  for (const breakpoint of BREAKPOINTS) {
    test(`no horizontal scroll at ${breakpoint.width}px (${breakpoint.label})`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: breakpoint.width,
        height: breakpoint.height,
      });
      // Viewport-dependent hydration mismatches (e.g. the sidebar's mobile
      // sheet vs desktop rail) only occur at some widths, so every breakpoint
      // also fails on any console error and uncaught exception.
      const clientErrors = collectConsoleErrors(page);
      page.on("pageerror", (error) => clientErrors.push(error.message));

      for (const item of NAV_ITEMS) {
        await page.goto(item.href);
        await waitForHydration(page);
        // The top-bar <h1> renders at every breakpoint (the sidebar collapses
        // to an overlay on mobile, but the header never does).
        await expect(
          page.getByRole("heading", { level: 1, name: item.pageTitle }),
        ).toBeVisible();

        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          overflow.scrollWidth,
          `${item.href} overflows horizontally at ${breakpoint.width}px`,
        ).toBeLessThanOrEqual(overflow.clientWidth);
      }

      expect(clientErrors).toEqual([]);
    });
  }
});

test.describe("responsive breakpoints - sign-in", () => {
  for (const breakpoint of BREAKPOINTS) {
    test(`sign-in has no horizontal scroll at ${breakpoint.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: breakpoint.width,
        height: breakpoint.height,
      });
      await page.goto("/sign-in");
      await expect(
        page.getByRole("heading", { name: "Bedrock Cost Dashboard" }),
      ).toBeVisible();

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        `/sign-in overflows horizontally at ${breakpoint.width}px`,
      ).toBeLessThanOrEqual(overflow.clientWidth);
    });
  }
});

test.describe("mobile sidebar sheet", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  // Guards the hydrated-flag gating in components/ui/sidebar.tsx: the sheet
  // must open on a first click once hydrated, at 375px from load and after a
  // 1440 -> 375 resize.
  test("opens the sidebar sheet at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard");
    await waitForHydration(page);

    await page.getByRole("button", { name: "Toggle Sidebar" }).click();

    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
  });

  test("opens the sidebar sheet after resizing from 1440px to 375px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    await waitForHydration(page);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();

    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
  });
});
