import { expect, type Page } from "@playwright/test";

// Web-first hydration signal (Rule 60.24, no networkidle). React attaches a
// `__reactProps$*` key to a DOM node once it has hydrated it. This is a
// React-internal detail: recheck it on React upgrades.
//
// Two boundaries are awaited because they hydrate independently: the header
// trigger (outside the <Suspense> in app/dashboard/layout.tsx) and the
// AppSidebar subtree (inside it). A hydration mismatch has been logged by the
// time both resolve.
export async function waitForHydration(page: Page): Promise<void> {
  const trigger = page.locator('[data-slot="sidebar-trigger"]');
  // Attached, not visible: the trigger is `md:hidden` on desktop.
  await expect(trigger).toBeAttached();
  await expect(trigger).toBeEnabled();
  await expect
    .poll(() =>
      trigger.evaluate((el) =>
        Object.keys(el).some((key) => key.startsWith("__reactProps$")),
      ),
    )
    .toBe(true);

  // Every `[data-slot="sidebar"]` must be hydrated. The SSR desktop rail is
  // present before hydration at all viewports; at 375px, once hydrated, it is
  // replaced by a closed sheet that renders no node, so "all hydrated" is the
  // signal that holds at every viewport (a stale un-hydrated rail fails it).
  await expect
    .poll(() =>
      page
        .locator('[data-slot="sidebar"]')
        .evaluateAll((els) =>
          els.every((el) =>
            Object.keys(el).some((key) => key.startsWith("__reactProps$")),
          ),
        ),
    )
    .toBe(true);
}
