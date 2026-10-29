import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { NAV_ITEMS } from "../lib/nav";
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
      page.getByRole("heading", { name: "Bedrock Cost Dashboard" }),
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
