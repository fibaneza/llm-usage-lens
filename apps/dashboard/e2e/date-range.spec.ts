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
      await expect(label).toBeVisible();
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

  test("picks an end date earlier than the first click and orders the range", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard?dateFrom=2026-01-10&dateTo=2026-01-20");

    await page.getByRole("button", { name: /custom date range/i }).click();
    await page
      .getByRole("button", { name: /January 28(st|nd|rd|th), 2026/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /January 25(st|nd|rd|th), 2026/ })
      .first()
      .click();

    await expect(page).toHaveURL(/dateFrom=2026-01-25/);
    await expect(page).toHaveURL(/dateTo=2026-01-28/);
  });

  test("closing the popover after one click discards the pending start", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard?dateFrom=2026-01-10&dateTo=2026-01-20");

    const trigger = page.getByRole("button", { name: /custom date range/i });
    await trigger.click();
    await page
      .getByRole("button", { name: /January 25(st|nd|rd|th), 2026/ })
      .first()
      .click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: /January 25(st|nd|rd|th), 2026/ }),
    ).toHaveCount(0);

    await trigger.click();
    await page
      .getByRole("button", { name: /January 28(st|nd|rd|th), 2026/ })
      .first()
      .click();

    // 28 starts a new range; the URL still carries the original one.
    await expect(page).toHaveURL(/dateFrom=2026-01-10/);
    await expect(page).toHaveURL(/dateTo=2026-01-20/);
  });

  test("custom-range label fits its pill without overflow at 1024px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/dashboard?dateFrom=2026-01-10&dateTo=2026-01-20");

    const trigger = page.getByRole("button", {
      name: "Custom date range: Jan 10 – Jan 20",
    });
    await expect(trigger).toBeVisible();
    const fits = await trigger.evaluate((el) => ({
      triggerFits: el.scrollWidth <= el.clientWidth,
      labelFits: Array.from(el.querySelectorAll("span")).every(
        (s) => s.scrollWidth <= s.clientWidth + 1,
      ),
    }));
    expect(fits.triggerFits).toBe(true);
    expect(fits.labelFits).toBe(true);
    await expect(trigger.getByText("Jan 10 – Jan 20")).toBeVisible();
    const [t, l] = await Promise.all([
      trigger.boundingBox(),
      trigger.getByText("Jan 10 – Jan 20").boundingBox(),
    ]);
    if (!t || !l) throw new Error("no layout box");
    expect(l.height).toBeLessThan(20);
    expect(l.x + l.width).toBeLessThanOrEqual(t.x + t.width + 0.5);
  });
});
