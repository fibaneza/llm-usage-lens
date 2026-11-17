import { expect, test, type BrowserContext } from "@playwright/test";

import { NAV_ITEMS } from "../lib/nav";
import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)". Pages now mount the combined sections; with a stored LiteLLM
// connection and no gateway, /api/litellm/combined/* answers 503 and the
// browser logs it as a console error. These specs are about the shell, so the
// combined routes answer the hidden head (packages/shared/src/schemas/combined.ts).
async function stubCombined(context: BrowserContext) {
  await context.route(/\/api\/litellm\/combined\//, (route) =>
    route.fulfill({
      json: {
        data: {
          visibility: "hidden",
          configured: true,
          gatewayConfigured: false,
        },
      },
    }),
  );
  // The Organisation page also reads /api/litellm/org; with a stored but
  // unreachable connection it answers 503 (LiteLLM spec - views by role, L3b),
  // so answer the not-configured shape (litellm-views.ts LiteLLMOrgResponseSchema).
  await context.route(/\/api\/litellm\/org(\?|$)/, (route) =>
    route.fulfill({
      json: {
        data: {
          configured: false,
          totals: { spend: 0 },
          daily: [],
          litellmTeams: [],
          appTeams: [],
          enabledOperations: [],
        },
      },
    }),
  );
}

// The design-system breakpoints (Rule 40.6). Heights are incidental — the
// checks below are about horizontal behaviour.
const BREAKPOINTS = [
  { label: "mobile", width: 375, height: 812 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "laptop", width: 1024, height: 768 },
  { label: "desktop", width: 1440, height: 900 },
  { label: "wide", width: 1920, height: 1080 },
] as const;

// Smoke-level responsive gate: no page may scroll horizontally at any
// breakpoint (implementation-phases spec — Phase 5 "Responsive testing").
// Chart resizing and touch-target sizes remain Phase 5 checks.
test.describe("responsive breakpoints", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
    await stubCombined(context);
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

// Design System -- Layout -> Structure: the content area is fluid (no
// page-level max-width). The content container is as wide as the SidebarInset,
// with gutters of 16px below 768, 24px from 768 and 32px from 1440. The
// container is the element that follows the top bar inside the inset.
test.describe("fluid content container", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  for (const [width, gutter] of [
    [375, 16],
    [767, 16],
    [768, 24],
    [1024, 24],
    [1439, 24],
    [1440, 32],
    [1920, 32],
  ] as const) {
    test(`container fills the inset with ${gutter}px gutters at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dashboard");
      await waitForHydration(page);

      const inset = page.locator('[data-slot="sidebar-inset"]');
      const container = inset.locator(":scope > header + *");
      await expect(container).toHaveCount(1);
      await expect(container).toBeVisible();

      const insetBox = await inset.boundingBox();
      const containerBox = await container.boundingBox();
      if (!insetBox || !containerBox) throw new Error("no layout box");
      expect(Math.abs(containerBox.width - insetBox.width)).toBeLessThanOrEqual(
        1,
      );

      const style = await container.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          maxWidth: cs.maxWidth,
          paddingLeft: cs.paddingLeft,
          paddingRight: cs.paddingRight,
        };
      });
      expect(style.maxWidth).toBe("none");
      expect(style.paddingLeft).toBe(`${gutter}px`);
      expect(style.paddingRight).toBe(`${gutter}px`);
    });
  }
});

// Slice B1 surfaces (implementation-phases Phase 5 Slice B tests: no horizontal
// scroll at 375 / 768 / 1024 / 1440): the shell for a non-global caller (the
// "user" role, a viewer with no team) on My usage and the Account page, which
// the NAV_ITEMS loop above (a global reader; Account is not a rail item) does
// not reach.
test.describe("responsive breakpoints - slice B1 shell for a user", () => {
  for (const breakpoint of BREAKPOINTS.filter((b) => b.width <= 1440)) {
    test(`My usage and Account have no horizontal scroll at ${breakpoint.width}px`, async ({
      context,
      page,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-viewer"] });
      await page.setViewportSize({
        width: breakpoint.width,
        height: breakpoint.height,
      });

      for (const path of ["/dashboard/me", "/dashboard/account"]) {
        await page.goto(path);
        await waitForHydration(page);
        await expect(
          page.getByRole("heading", { level: 1 }).first(),
        ).toBeVisible();

        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          overflow.scrollWidth,
          `${path} overflows horizontally at ${breakpoint.width}px`,
        ).toBeLessThanOrEqual(overflow.clientWidth);
      }
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
        page.getByRole("heading", { name: "LLM Usage Lens" }),
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

// WAI-ARIA modal dialog pattern for the mobile sheet: Escape dismisses it and
// focus returns to the control that opened it; following a nav link navigates
// and closes it, since the layout (and so the sheet's open state) persists
// across client-side navigations (design-system — Layout → Sidebar: overlay on
// mobile). The whole block also fails on any console error or uncaught
// exception, like the breakpoint checks above.
test.describe("mobile sidebar sheet - dismissal", () => {
  let clientErrors: string[];

  test.beforeEach(async ({ context, page }) => {
    await signInAsTestUser(context);
    await stubCombined(context);
    await page.setViewportSize({ width: 375, height: 812 });
    clientErrors = collectConsoleErrors(page);
    page.on("pageerror", (error) => clientErrors.push(error.message));
  });

  test.afterEach(() => {
    expect(clientErrors).toEqual([]);
  });

  // The only "Toggle Sidebar" button at 375px: the sheet's rail is `hidden
  // sm:flex`, and the closed sheet renders no nodes.
  const sidebarTrigger = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: "Toggle Sidebar" });

  test("closes on Escape and returns focus to the sidebar trigger", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await waitForHydration(page);

    const trigger = sidebarTrigger(page);
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Sidebar" });
    await expect(sheet).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("closes the sheet and navigates when a nav link is clicked", async ({
    page,
  }) => {
    // Compile the destination before the click so the dev server's first-hit
    // compile does not race the assertions (Rule 60.24 - no sleeps).
    await page.request.get("/dashboard/ranking");
    await page.goto("/dashboard");
    await waitForHydration(page);

    await sidebarTrigger(page).click();
    const sheet = page.getByRole("dialog", { name: "Sidebar" });
    await expect(sheet).toBeVisible();

    await sheet.getByRole("link", { name: "Ranking" }).click();

    await expect(page).toHaveURL(/\/dashboard\/ranking(\?|$)/);
    // Sheet first: while a modal is open Radix marks the rest of the page
    // aria-hidden, so a role query for the heading cannot see it.
    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole("heading", { level: 1, name: "Cost ranking" }),
    ).toBeVisible();
  });

  test("closes the sheet and navigates when the Administration Settings link is clicked", async ({
    page,
  }) => {
    await page.request.get("/dashboard/settings");
    await page.goto("/dashboard");
    await waitForHydration(page);

    await sidebarTrigger(page).click();
    const sheet = page.getByRole("dialog", { name: "Sidebar" });
    await expect(sheet).toBeVisible();

    await sheet.getByRole("link", { name: "Settings" }).click();

    await expect(page).toHaveURL(/\/dashboard\/settings\/accounts(\?|$)/);
    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();
  });

  test("reopens on the first trigger click after navigating from the sheet", async ({
    page,
  }) => {
    await page.request.get("/dashboard/ranking");
    await page.goto("/dashboard");
    await waitForHydration(page);

    await sidebarTrigger(page).click();
    const sheet = page.getByRole("dialog", { name: "Sidebar" });
    await sheet.getByRole("link", { name: "Ranking" }).click();
    await expect(page).toHaveURL(/\/dashboard\/ranking(\?|$)/);
    await expect(sheet).toBeHidden();

    await sidebarTrigger(page).click();

    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
  });
});

// WCAG 4.1.2 (Rule 60.30): in the sheet the content is always expanded and the
// footer toggle closes it, so it is named "Collapse" even after the user
// collapsed the desktop rail and then narrowed the window. The sidebar state
// is not read from the cookie on load, so the collapse must happen in-session
// at desktop width.
test.describe("mobile sidebar sheet - rail toggle name", () => {
  let clientErrors: string[];

  test.beforeEach(async ({ context, page }) => {
    await signInAsTestUser(context);
    await stubCombined(context);
    clientErrors = collectConsoleErrors(page);
    page.on("pageerror", (error) => clientErrors.push(error.message));
  });

  test.afterEach(() => {
    expect(clientErrors).toEqual([]);
  });

  test("is named Collapse in the sheet from load at 375px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard");
    await waitForHydration(page);

    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    const sheet = page.getByRole("dialog", { name: "Sidebar" });

    await expect(
      sheet.getByRole("button", { name: "Collapse", exact: true }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "Expand", exact: true }),
    ).toHaveCount(0);
  });

  test("stays Collapse in the sheet after collapsing the rail at 1440px and resizing to 375px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    await waitForHydration(page);
    await page.getByRole("button", { name: "Collapse", exact: true }).click();
    await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute(
      "data-state",
      "collapsed",
    );
    await expect(
      page.getByRole("button", { name: "Expand", exact: true }),
    ).toBeVisible();

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    const sheet = page.getByRole("dialog", { name: "Sidebar" });

    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "Collapse", exact: true }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "Expand", exact: true }),
    ).toHaveCount(0);

    await sheet.getByRole("button", { name: "Collapse", exact: true }).click();

    await expect(sheet).toBeHidden();
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

  // ARIA roles (WAI-ARIA timer pattern): the countdown is a `timer`, which is
  // implicitly aria-live="off" so it does not announce every tick; the sync
  // badge stays a `status` live region. The countdown must not be a `status`.
  for (const width of [768, 1024, 1440]) {
    test(`countdown is a timer and the sync badge a status at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dashboard");
      const h = header(page);
      await expect(h.getByRole("timer", { name: /^Next sync/ })).toBeVisible();
      await expect(
        h.getByRole("status", { name: /^Sync status/ }),
      ).toBeVisible();
      await expect(h.getByRole("status", { name: /^Next sync/ })).toHaveCount(
        0,
      );
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
  // The header reads /api/sync-status since Phase 4.1 (implementation-phases —
  // "Connect SyncStatusBadge and SyncCountdown to real data"), so the response
  // is fulfilled from fixtures: the labels must not depend on whatever
  // DynamoDB Local holds (Rule 60.24; same pattern as overview.spec.ts).
  const SYNC_STATUS_URL = /\/api\/sync-status(\?|$)/;
  const NEVER_SYNCED_BODY = { data: { state: "never-synced" } };

  function syncedBody(minutesAhead = 42) {
    // Half a minute of slack so the label reads the same whole-minute value
    // regardless of how quickly the page loads.
    const next = new Date(Date.now() + (minutesAhead * 60 + 30) * 1000);
    return {
      data: {
        state: "synced",
        status: {
          lastRunAt: new Date(next.getTime() - 3_600_000).toISOString(),
          nextScheduledAt: next.toISOString(),
          status: "success",
          accountsTotal: 5,
          accountsSuccess: 5,
          accountsFailed: 0,
          errors: [],
          durationMs: 12_000,
        },
      },
    };
  }

  async function stubSyncStatus(
    page: import("@playwright/test").Page,
    body: unknown,
  ) {
    await page.route(SYNC_STATUS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        json: body,
      }),
    );
  }

  for (const width of [1024, 1440]) {
    test(`sync status shows its text labels at ${width}px when never synced`, async ({
      page,
    }) => {
      await stubSyncStatus(page, NEVER_SYNCED_BODY);
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dashboard");
      await waitForHydration(page);
      const h = header(page);
      await expect(h.getByText("No sync yet")).toBeVisible();
      await expect(h.getByText("Next sync —")).toBeVisible();
      await expect(
        h.getByRole("timer", { name: "Next sync: pending" }),
      ).toBeVisible();
    });

    test(`sync status shows its text labels at ${width}px when synced`, async ({
      page,
    }) => {
      await stubSyncStatus(page, syncedBody());
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dashboard");
      await waitForHydration(page);
      const h = header(page);
      await expect(h.getByText("Success", { exact: true })).toBeVisible();
      await expect(h.getByText(/^Next sync in \d+ min$/)).toBeVisible();
    });
  }

  test("sync status is icon-only at 768px", async ({ page }) => {
    await stubSyncStatus(page, NEVER_SYNCED_BODY);
    await page.setViewportSize({ width: 768, height: 800 });
    await page.goto("/dashboard");
    await waitForHydration(page);
    const h = header(page);
    // The never-synced view is on screen (its aria-label proves the stub
    // landed), yet neither visible text label renders below `lg`.
    await expect(h.getByLabel("Sync status: no sync yet")).toBeVisible();
    await expect(h.getByText("No sync yet")).toBeHidden();
    await expect(h.getByText("Next sync —")).toBeHidden();
  });

  test("synced sync status is icon-only at 768px", async ({ page }) => {
    await stubSyncStatus(page, syncedBody());
    await page.setViewportSize({ width: 768, height: 800 });
    await page.goto("/dashboard");
    await waitForHydration(page);
    const h = header(page);
    await expect(
      h.getByLabel(/^Sync status: success, last run .*\d{2}:\d{2} UTC$/),
    ).toBeVisible();
    await expect(h.getByText("Success", { exact: true })).toBeHidden();
    await expect(h.getByText(/^Next sync in \d+ min$/)).toBeHidden();
  });
});
