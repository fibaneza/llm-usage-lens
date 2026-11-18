import { expect, test, type Page } from "@playwright/test";

import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";
import { stubUsageSourceReads } from "./support/usage-source-stubs";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)". Pages now mount the combined sections; with a stored LiteLLM
// connection and no gateway, /api/litellm/combined/* answers 503 and the
// browser logs it as a console error. These specs are about the shell, so the
// combined routes answer the hidden head (packages/shared/src/schemas/combined.ts).

// Desktop icon rail (design-system — Layout → Sidebar: collapsible, persistent
// on desktop). While collapsed to icons a tooltip names each link; while
// expanded the label is already visible, so there is none. SidebarMenuButton's
// tooltip is controlled (never open on mobile), so these guard the desktop
// hover/focus/dismiss behaviour. 768 is the first desktop width (`md`), 1440 a
// wide one.
for (const width of [768, 1440]) {
  test.describe(`sidebar rail tooltips at ${width}px`, () => {
    let clientErrors: string[];

    test.beforeEach(async ({ context, page }) => {
      await signInAsTestUser(context);
      await stubUsageSourceReads(context);
      await page.setViewportSize({ width, height: 900 });
      clientErrors = collectConsoleErrors(page);
      page.on("pageerror", (error) => clientErrors.push(error.message));
      await page.goto("/dashboard");
      await waitForHydration(page);
    });

    test.afterEach(() => {
      expect(clientErrors).toEqual([]);
    });

    const tooltip = (page: Page, name: string) =>
      page.getByRole("tooltip", { name, exact: true });

    // Radix closes a tooltip on pointerdown, and a single-jump move would skip
    // its grace area, so leave the rail in many small steps (toward the page
    // content, away from the dev-mode indicator in the bottom-left corner).
    const movePointerAway = (page: Page) =>
      page.mouse.move(width - 10, 600, { steps: 10 });

    async function collapseRail(page: Page) {
      await page.getByRole("button", { name: "Collapse" }).click();
      await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute(
        "data-state",
        "collapsed",
      );
      await movePointerAway(page);
    }

    test("collapsed: hovering a link shows its tooltip and leaving hides it", async ({
      page,
    }) => {
      await collapseRail(page);

      await page.getByRole("link", { name: "Ranking" }).hover();
      await expect(tooltip(page, "Ranking")).toBeVisible();

      await movePointerAway(page);
      await expect(tooltip(page, "Ranking")).toBeHidden();
    });

    // MI-D1: My usage is the second item, so Tab from Overview reaches it.
    test("collapsed: keyboard focus shows a link's tooltip and Escape hides it", async ({
      page,
    }) => {
      await collapseRail(page);

      await page.getByRole("link", { name: "Overview", exact: true }).focus();
      await page.keyboard.press("Tab");

      await expect(page.getByRole("link", { name: "My usage" })).toBeFocused();
      await expect(tooltip(page, "My usage")).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(tooltip(page, "My usage")).toBeHidden();
    });

    test("collapsed: the toggle's tooltip says Expand", async ({ page }) => {
      await collapseRail(page);

      // Tab from the Settings link (the last link, in Administration): the
      // toggle is next, alone in the footer, and the click that collapsed the
      // rail left it focused without a tooltip.
      await page.getByRole("link", { name: "Settings" }).focus();
      await page.keyboard.press("Tab");

      await expect(
        page.getByRole("button", { name: "Expand", exact: true }),
      ).toBeFocused();
      await expect(tooltip(page, "Expand")).toBeVisible();
    });

    // WCAG 4.1.2 (Rule 60.30): the toggle is named for the action it performs.
    test("the toggle is named Collapse while expanded and Expand once collapsed", async ({
      page,
    }) => {
      await expect(
        page.getByRole("button", { name: "Collapse", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Expand", exact: true }),
      ).toHaveCount(0);

      await collapseRail(page);

      await expect(
        page.getByRole("button", { name: "Expand", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Collapse", exact: true }),
      ).toHaveCount(0);
    });

    test("collapsed: hovering the toggle shows a tooltip equal to its name", async ({
      page,
    }) => {
      await collapseRail(page);

      const toggle = page.getByRole("button", { name: "Expand", exact: true });
      await toggle.hover();

      await expect(tooltip(page, "Expand")).toBeVisible();
      await expect(toggle).toHaveAccessibleName("Expand");
    });

    test("the toggle expands the collapsed rail and is named Collapse again", async ({
      page,
    }) => {
      await collapseRail(page);

      await page.getByRole("button", { name: "Expand", exact: true }).click();

      await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute(
        "data-state",
        "expanded",
      );
      await expect(
        page.getByRole("button", { name: "Collapse", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Expand", exact: true }),
      ).toHaveCount(0);
    });

    test("expanded: hovering a link shows no tooltip", async ({ page }) => {
      const ranking = page.getByRole("link", { name: "Ranking" });

      await ranking.hover();

      // Radix reflects the hover on the trigger as data-state; waiting for it
      // keeps the negative assertion below from passing before the hover lands.
      await expect(ranking).toHaveAttribute("data-state", /-open$/);
      await expect(tooltip(page, "Ranking")).toBeHidden();
    });

    test("expanded: keyboard focus shows no tooltip", async ({ page }) => {
      await page.getByRole("link", { name: "Overview", exact: true }).focus();
      await page.keyboard.press("Tab");

      const ranking = page.getByRole("link", { name: "My usage" });
      await expect(ranking).toBeFocused();
      await expect(ranking).toHaveAttribute("data-state", /-open$/);
      await expect(tooltip(page, "Ranking")).toBeHidden();
    });
  });
}
