import { expect, test } from "@playwright/test";

import { waitForAnimations } from "./support/animations";

// Design System - accessibility (WCAG AA): axe scans wait for animations, but
// an infinite one (animate-pulse skeleton, animate-spin) must not hang the wait.
test("waitForAnimations returns while an infinite animation runs and waits for a finite one", async ({
  page,
}) => {
  await page.setContent(`
    <style>
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
      #inf { animation: spin 1s linear infinite; }
      #fin { animation: fade 300ms linear forwards; }
    </style>
    <div id="inf">x</div><div id="fin">y</div>`);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(2);

  const result = await Promise.race([
    waitForAnimations(page).then(() => "done"),
    new Promise((resolve) => setTimeout(() => resolve("hung"), 2_000)),
  ]);
  expect(result).toBe("done");
  expect(
    await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .every((a) => a.playState === "finished"),
    ),
  ).toBe(true);
});
