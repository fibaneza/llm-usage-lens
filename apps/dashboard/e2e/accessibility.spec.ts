import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { NAV_ITEMS } from "../lib/nav";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Smoke-level accessibility gate: serious/critical axe violations fail the
// suite on every nav page, so a11y debt surfaces with the component that
// introduces it instead of piling up for the Phase 5 audit
// (implementation-phases spec — Phase 5; Rule 60.30). The full WCAG AA pass
// (contrast targets, screen-reader walkthrough) remains a Phase 5 task.
test.describe("accessibility (axe)", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  for (const item of NAV_ITEMS) {
    test(`${item.title} page has no serious or critical violations`, async ({
      page,
    }) => {
      await page.goto(item.href);
      await expect(
        page.getByRole("heading", { level: 1, name: item.pageTitle }),
      ).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();

      const blocking = results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );

      expect(
        blocking.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map((node) => node.target.join(" ")),
        })),
      ).toEqual([]);
    });
  }
});

// /sign-in is the one public page (not in NAV_ITEMS), so it is checked
// without a session.
test.describe("accessibility (axe) - public pages", () => {
  test("sign-in page has no serious or critical violations", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await expect(
      page.getByRole("heading", { name: "LLM Usage Lens" }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const blocking = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );

    expect(
      blocking.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => node.target.join(" ")),
      })),
    ).toEqual([]);
  });
});

// Slice B1 surfaces at the four project breakpoints (implementation-phases
// Phase 5 Slice B tests: "axe clean and no horizontal scroll at 375 / 768 /
// 1024 / 1440"; Design System - Navigation (Sidebar), Layout). NAV_ITEMS above
// cover the pages as a global reader at the default viewport; these cover what
// they cannot: the shell as a non-global caller (a viewer with no team, the
// "user" role: Usage (My usage only), Management and Administration) on My usage, the
// open mobile sheet, the Account page, and the sign-in page at every width.
const B1_WIDTHS = [375, 768, 1024, 1440] as const;

async function expectNoBlockingViolations(
  page: import("@playwright/test").Page,
) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((node) => node.target.join(" ")),
      })),
  ).toEqual([]);
}

test.describe("accessibility (axe) - slice B1 surfaces", () => {
  for (const width of B1_WIDTHS) {
    test(`My usage shell for a user is clean at ${width}px`, async ({
      context,
      page,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-viewer"] });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dashboard/me");
      await waitForHydration(page);
      await expect(
        page.getByRole("heading", { level: 1, name: "My usage" }),
      ).toBeVisible();

      await expectNoBlockingViolations(page);
    });

    // BL2 (round-1 review): the admin's Overview.
    test(`Overview shell for an admin is clean at ${width}px`, async ({
      context,
      page,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dashboard");
      await waitForHydration(page);
      await expect(
        page.getByRole("heading", { level: 1, name: "Cost overview" }),
      ).toBeVisible();

      await expectNoBlockingViolations(page);
    });

    // BL2: the admin's sidebar. The sheet exists only below the 768px mobile
    // breakpoint (hooks/use-mobile.ts); at 768+ the expanded rail is the
    // equivalent surface.
    test(`admin sidebar (${width < 768 ? "open sheet" : "expanded rail"}) is clean at ${width}px`, async ({
      context,
      page,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dashboard");
      await waitForHydration(page);
      if (width < 768) {
        await page.getByRole("button", { name: "Toggle Sidebar" }).click();
        await expect(
          page.getByRole("dialog", { name: "Sidebar" }),
        ).toBeVisible();
      }
      const nav = page.getByRole("navigation", { name: "Primary" });
      for (const label of ["Usage", "Management", "Administration"]) {
        await expect(nav.getByText(label, { exact: true })).toBeVisible();
      }

      await expectNoBlockingViolations(page);
    });

    test(`Account page is clean at ${width}px`, async ({ context, page }) => {
      await signInAsTestUser(context, { roles: ["internal-viewer"] });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dashboard/account");
      await waitForHydration(page);
      await expect(
        page.getByRole("heading", { name: "Account" }),
      ).toBeVisible();

      await expectNoBlockingViolations(page);
    });

    test(`sign-in page is clean at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/sign-in");
      await expect(
        page.getByRole("heading", { level: 1, name: "LLM Usage Lens" }),
      ).toBeVisible();

      await expectNoBlockingViolations(page);
    });
  }

  test("the open mobile sidebar sheet is clean for a user at 375px", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard/me");
    await waitForHydration(page);
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    const sheet = page.getByRole("dialog", { name: "Sidebar" });
    await expect(sheet).toBeVisible();
    const nav = sheet.getByRole("navigation", { name: "Primary" });
    // B1-14: the Usage group is present and holds only My usage.
    await expect(nav.getByText("Usage", { exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "My usage" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveCount(0);
    // B2-2: a user has no Management or Administration item, so neither group
    // is rendered.
    await expect(nav.getByText("Management", { exact: true })).toHaveCount(0);
    await expect(nav.getByText("Administration", { exact: true })).toHaveCount(
      0,
    );

    await expectNoBlockingViolations(page);
  });
});

// Slice B2 surfaces at the four project breakpoints (implementation-phases
// Phase 5 Slice B tests: "axe clean and no horizontal scroll at 375 / 768 /
// 1024 / 1440"; Design System - Management pages). NAV_ITEMS above reach each
// Management page once, as the default auditor, at the default viewport; this
// adds every width as an admin (write controls rendered) for the pages whose
// layout is new, and the Settings page frame.
const B2_PAGES: readonly [string, string][] = [
  ["/dashboard/manage/team", "Team management"],
  // Unit TM1: the team page opened from the list (team-payments is seeded;
  // an unknown id is 404).
  ["/dashboard/manage/team/team-payments", "Team management"],
  ["/dashboard/manage/litellm/organisation", "LiteLLM"],
  ["/dashboard/manage/users", "Users"],
  ["/dashboard/manage/audit", "Audit log"],
  ["/dashboard/me", "My usage"],
  ["/dashboard/settings/accounts", "Settings"],
];

test.describe("accessibility (axe) - slice B2 surfaces", () => {
  for (const [path, heading] of B2_PAGES) {
    for (const width of B1_WIDTHS) {
      test(`${path} is axe-clean with no horizontal scroll at ${width}px`, async ({
        context,
        page,
      }) => {
        await signInAsTestUser(context, { roles: ["internal-admin"] });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await waitForHydration(page);
        await expect(
          page.getByRole("heading", { level: 1, name: heading }),
        ).toBeVisible();

        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          overflow.scrollWidth,
          `${path} overflows horizontally at ${width}px`,
        ).toBeLessThanOrEqual(overflow.clientWidth);

        await expectNoBlockingViolations(page);
      });
    }
  }
});
