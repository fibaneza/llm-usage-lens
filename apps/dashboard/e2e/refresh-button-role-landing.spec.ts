import {
  expect,
  type BrowserContext,
  type Page,
  type Request,
  test,
} from "@playwright/test";

import { PROBE_ROLES, seedRoleProbe } from "../test/fixtures/role-probe-seed";

import { expectNoBlockingViolations } from "./support/axe";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System - Component Inventory, RefreshButton (D-R3-2: a top-bar
// icon button for every signed-in caller) and Caching Strategy, Refresh (T-RF1,
// T-RF2: a click reloads the data; the no-cache sync-status request exists only
// for a caller who sees the sync status, so a Lead sends none). The file name
// matches PROBE_SPEC in playwright.config.ts: a team-scope Lead exists only as
// the DynamoDB grants the role-probe project seeds, so the Lead case lives in
// the role-probe project (the global reader and member cases are in
// refresh-button.spec.ts). Axe: WCAG 2 A/AA, serious or critical, at 375px and
// desktop, as in accessibility.spec.ts.
test.beforeAll(seedRoleProbe);

const BUTTON = { name: "Refresh data" };
const SYNC_STATUS = /\/api\/sync-status(\?|$)/;

async function openAsLead(page: Page, context: BrowserContext) {
  const lead = PROBE_ROLES.find((r) => r.name === "team-admin");
  if (!lead) throw new Error("unknown probe role team-admin");
  await signInAsTestUser(context, { oid: lead.oid, roles: lead.roles });
  await page.goto("/dashboard/me");
  await waitForHydration(page);
}

test.describe("refresh button - lead (team scope)", () => {
  test("is in the top bar, a click refreshes the page and sends no sync-status request (T-RF1, T-RF2)", async ({
    page,
    context,
  }) => {
    await openAsLead(page, context);
    const button = page.getByRole("button", BUTTON);
    await expect(button).toBeVisible();

    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));
    await button.click();

    // U-W3: the page refresh is an _rsc request, as for the viewer case.
    await expect
      .poll(() => requests.some((r) => r.url().includes("_rsc")))
      .toBe(true);
    expect(requests.filter((r) => SYNC_STATUS.test(r.url()))).toHaveLength(0);
  });

  for (const width of [375, 1280]) {
    test(`axe clean at ${width}px (D-R3-2)`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 800 });
      await openAsLead(page, context);
      await expect(page.getByRole("button", BUTTON)).toBeVisible();
      await expectNoBlockingViolations(page);
    });
  }
});
