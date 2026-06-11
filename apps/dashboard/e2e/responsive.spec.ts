import { expect, test } from "@playwright/test";

import { NAV_ITEMS } from "../lib/nav";
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

      for (const item of NAV_ITEMS) {
        await page.goto(item.href);
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
    });
  }
});
