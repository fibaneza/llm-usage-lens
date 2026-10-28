import { expect, test } from "@playwright/test";

import { signInAsTestUser } from "./support/session";

// Custom range in the header: readable label at every breakpoint and a start
// date that can be chosen freely (design-system — Date Filtering).
test.describe("custom date range", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  for (const width of [375, 768, 1440]) {
    test(`label is fully visible and unclipped at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dashboard?dateFrom=2026-01-10&dateTo=2026-01-20");

      const trigger = page.getByRole("button", {
        name: "Custom date range: Jan 10 – Jan 20",
      });
      await expect(trigger).toBeVisible();
      const label = trigger.getByText("Jan 10 – Jan 20");
      const [t, l] = await Promise.all([
        trigger.boundingBox(),
        label.boundingBox(),
      ]);
      if (!t || !l) throw new Error("no layout box");
      // Text on a single line, and contained by the pill.
      expect(l.height).toBeLessThan(20);
      expect(l.x).toBeGreaterThanOrEqual(t.x - 0.5);
      expect(l.x + l.width).toBeLessThanOrEqual(t.x + t.width + 0.5);
      expect(l.y + l.height).toBeLessThanOrEqual(t.y + t.height + 0.5);
    });
  }

  test("picks a start date later than the current end, then an end date", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard?dateFrom=2026-01-10&dateTo=2026-01-20");

    await page.getByRole("button", { name: /custom date range/i }).click();
    await page
      .getByRole("button", { name: /January 25(st|nd|rd|th), 2026/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /January 28(st|nd|rd|th), 2026/ })
      .first()
      .click();

    await expect(page).toHaveURL(/dateFrom=2026-01-25/);
    await expect(page).toHaveURL(/dateTo=2026-01-28/);
  });
});
