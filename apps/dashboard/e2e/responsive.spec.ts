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

// Top bar: may wrap only below `md`; from 768px up it stays one row, and its
// bottom border lines up with the sidebar header's (design-system — layout,
// breakpoints; Rule 40.6).
test.describe("top bar layout", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  for (const width of [768, 900, 1023, 1024]) {
    test(`header is a single row at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dashboard");
      const header = page
        .locator("header")
        .filter({ has: page.getByRole("heading", { level: 1 }) });
      await expect(header).toBeVisible();
      // The picker sits under Suspense; boundingBox() does not auto-wait.
      const picker = header.getByRole("button", { name: "Last 30 days" });
      await expect(picker).toBeVisible();

      const sidebarHeader = page.locator('[data-slot="sidebar-header"]');
      await expect(sidebarHeader.first()).toBeVisible();
      const [h, title, pickerBox, sh] = await Promise.all([
        header.boundingBox(),
        header.getByRole("heading", { level: 1 }).boundingBox(),
        picker.boundingBox(),
        sidebarHeader.first().boundingBox(),
      ]);
      if (!h || !title || !pickerBox || !sh) throw new Error("no layout box");

      // Single row: the bar is no taller than the 3.5rem (56px) header height,
      // and title and date filter are vertically centred on the same line.
      expect(h.height).toBeLessThanOrEqual(57);
      const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
      expect(Math.abs(mid(title) - mid(pickerBox))).toBeLessThanOrEqual(2);

      // Header and sidebar-header bottom borders align.
      expect(Math.abs(h.y + h.height - (sh.y + sh.height))).toBeLessThanOrEqual(
        1,
      );
    });
  }

  test("header may wrap at 375px without horizontal scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});

// Sync status, date filter, search and account menu stay reachable in the top
// bar from `md` up; tight widths may use compact forms but never drop them
// (design-system — Layout → Structure, Status & Feedback; Rule 40.6).
// Stable accessible names the implementation must expose:
//   SyncStatusBadge -> an element with aria-label starting "Sync status"
//   SyncCountdown   -> an element with aria-label starting "Next sync"
test.describe("top bar controls", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  const header = (page: import("@playwright/test").Page) =>
    page
      .locator("header")
      .filter({ has: page.getByRole("heading", { level: 1 }) });

  async function expectNoDocumentOverflow(
    page: import("@playwright/test").Page,
  ) {
    const o = await page.evaluate(() => ({
      s: document.documentElement.scrollWidth,
      c: document.documentElement.clientWidth,
    }));
    expect(o.s).toBeLessThanOrEqual(o.c);
  }

  for (const width of [768, 1024, 1279, 1280, 1440]) {
    test(`all top bar controls are visible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dashboard");
      const h = header(page);
      await expect(h).toBeVisible();
      await expect(
        h.getByRole("button", { name: "Last 30 days" }),
      ).toBeVisible();
      await expect(h.getByRole("button", { name: /^Search/ })).toBeVisible();
      await expect(
        h.getByRole("button", { name: "Open user menu" }),
      ).toBeVisible();
      await expect(h.getByLabel(/^Sync status/)).toBeVisible();
      await expect(h.getByLabel(/^Next sync/)).toBeVisible();
    });
  }

  for (const width of [768, 900, 1023, 1024, 1279, 1280, 1440]) {
    test(`single row, no overflow, aligned border at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dashboard");
      const h = header(page);
      await expect(
        h.getByRole("button", { name: "Last 30 days" }),
      ).toBeVisible();
      const sidebarHeader = page
        .locator('[data-slot="sidebar-header"]')
        .first();
      await expect(sidebarHeader).toBeVisible();
      const badge = h.getByLabel(/^Sync status/);
      const countdown = h.getByLabel(/^Next sync/);
      await expect(badge).toBeVisible();
      await expect(countdown).toBeVisible();

      const [hb, sh, bb, cb] = await Promise.all([
        h.boundingBox(),
        sidebarHeader.boundingBox(),
        badge.boundingBox(),
        countdown.boundingBox(),
      ]);
      if (!hb || !sh || !bb || !cb) throw new Error("no layout box");
      expect(hb.height).toBeLessThanOrEqual(57);
      expect(
        Math.abs(hb.y + hb.height - (sh.y + sh.height)),
      ).toBeLessThanOrEqual(1);
      // Status controls sit on the bar's row, not wrapped below it.
      for (const b of [bb, cb]) {
        expect(b.y).toBeGreaterThanOrEqual(hb.y);
        expect(b.y + b.height).toBeLessThanOrEqual(hb.y + hb.height + 1);
      }
      await expectNoDocumentOverflow(page);
    });
  }

  // Below md the bar may wrap, but the countdown stays shown from sm (640px).
  for (const width of [640, 700, 767]) {
    test(`countdown is visible without overflow at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dashboard");
      const h = header(page);
      await expect(
        h.getByRole("button", { name: "Last 30 days" }),
      ).toBeVisible();
      await expect(h.getByLabel(/^Next sync/)).toBeVisible();
      await expectNoDocumentOverflow(page);
    });
  }

  for (const width of [768, 1024, 1279, 1440]) {
    test(`search trigger advertises its shortcut at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dashboard");
      const search = header(page).getByRole("button", { name: /^Search/ });
      await expect(search).toBeVisible();
      await expect(search).toHaveAttribute(
        "aria-keyshortcuts",
        "Meta+K Control+K",
      );
      await expect(search).toHaveAttribute("title", "Search (⌘K)");
    });
  }

  // Design system — Layout: the search trigger shows its "Search…" label and
  // ⌘K hint from 1440px and is icon-only (a 36px square) below. Checks the
  // rendered result, since Tailwind v4 rule order can defeat a `min-[1440px]:`
  // variant against `md:`.
  for (const width of [1440, 1600]) {
    test(`search trigger shows its label and hint at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dashboard");
      const search = header(page).getByRole("button", { name: /^Search/ });
      await expect(search).toBeVisible();
      await expect(search.getByText("Search…")).toBeVisible();
      await expect(search.getByText("⌘K", { exact: true })).toBeVisible();
      const box = await search.boundingBox();
      if (!box) throw new Error("no layout box");
      expect(box.width).toBeGreaterThan(36);
    });
  }

  for (const width of [768, 1024, 1279, 1439]) {
    test(`search trigger is icon-only at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dashboard");
      const search = header(page).getByRole("button", { name: /^Search/ });
      await expect(search).toBeVisible();
      await expect(search.getByText("Search…")).toBeHidden();
      await expect(search.getByText("⌘K", { exact: true })).toBeHidden();
      const box = await search.boundingBox();
      if (!box) throw new Error("no layout box");
      expect(Math.abs(box.width - 36)).toBeLessThanOrEqual(2);
    });
  }

  // Sync status text labels appear from `lg` (1024px); icon-only at `md`.
  for (const width of [1024, 1440]) {
    test(`sync status shows its text labels at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dashboard");
      const h = header(page);
      await expect(h.getByText("No sync yet")).toBeVisible();
      await expect(h.getByText("Next sync —")).toBeVisible();
    });
  }

  test("sync status is icon-only at 768px", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 800 });
    await page.goto("/dashboard");
    const h = header(page);
    await expect(h.getByLabel(/^Sync status/)).toBeVisible();
    await expect(h.getByText("No sync yet")).toBeHidden();
    await expect(h.getByText("Next sync —")).toBeHidden();
  });
});
