import type { Page } from "@playwright/test";

// Waits for running CSS transitions and animations to finish. A scan
// mid-transition reads interpolated colours, so axe reports a false
// color-contrast failure (Design System — accessibility, WCAG AA). Call it
// right before each axe scan; cancelled animations resolve too.
export async function waitForAnimations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        // An infinite animation (animate-pulse, animate-spin) never finishes.
        .filter((a) => {
          const timing = a.effect?.getComputedTiming();
          return (
            timing?.iterations !== Infinity && timing?.endTime !== Infinity
          );
        })
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}
