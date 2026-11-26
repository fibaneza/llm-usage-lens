import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System -- Management pages, Team usage (unit M2, MI-D7: the
// spend panel left the Team page; "LiteLLM-reported spend for your teams", a
// "Team" picker when the caller has more than one team, `?team=` as a history
// push); Access Control -- Created app teams (T-MI4: a global reader opens
// every team); App Teams spec -- Spend source, UI (AT4, AT6: linked figure,
// member sum, "not in LiteLLM", the cap wording). The server gate reads only
// DynamoDB (the seeded teams), so the team ids are the default seed's; the
// browser's LiteLLM calls are fulfilled from fixtures, which keeps the spec
// independent of a local LiteLLM and of the CI table having no connection
// (docs/guides/testing.md -- E2E without LiteLLM). The lead and user cases
// (the 404s, the lead's scope) need the role-probe identities and live in
// role-landing.spec.ts (PROBE_SPEC in playwright.config.ts). Rule 60.24a: API
// rules are tested elsewhere; this reads the page in the real shell.
const PAYMENTS = "team-payments";
const PLATFORM = "team-platform";
const GUILD = "appteam-00000000-0000-4000-8000-000000000001";
const TEAM_USAGE = "/dashboard/team-usage";

const DAILY = [{ date: "2026-11-02", spend: 4 }];
const MEMBER_SUM = {
  total: 4,
  daily: DAILY,
  coverage: { members: 4, matched: 3, unmatched: 1, pending: 1 },
  members: [
    { oid: "oid-u1", name: "Una One", matched: true, spend: 3.5 },
    { oid: "oid-u2", name: "Dos Two", matched: true, spend: 0.5 },
    { oid: "oid-u3", name: "Tres Three", matched: false },
    { oid: "oid-u4", name: "Cuatro Four", matched: true },
  ],
};

// team-payments is linked (the LiteLLM team figure, plus the member sum a
// global reader asks for); every other team is unlinked (the member sum).
async function stubTeamDetail(page: Page, seen: string[] = []) {
  await page.route(/\/api\/litellm\/teams\/([^/?]+)(\?|$)/, (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/").pop();
    seen.push(`${id}${url.search}`);
    const withSum = url.searchParams.get("include") === "memberSum";
    if (id === PAYMENTS) {
      return route.fulfill({
        json: {
          data: {
            connected: true,
            spendSource: "litellm-team",
            team: {
              alias: "Payments",
              spend: 321.75,
              maxBudget: 500,
              softBudget: null,
              budgetDuration: "30d",
              models: ["claude-sonnet"],
              rpmLimit: null,
              tpmLimit: null,
            },
            daily: DAILY,
            ...(withSum
              ? { memberSum: { ...MEMBER_SUM, total: 250, daily: [] } }
              : {}),
            enabledOperations: [],
          },
        },
      });
    }
    return route.fulfill({
      json: {
        data: {
          connected: false,
          spendSource: "member-sum",
          daily: DAILY,
          memberSum: MEMBER_SUM,
        },
      },
    });
  });
}

const picker = (page: Page) =>
  page.getByRole("combobox", { name: "Team", exact: true });
const spendRegion = (page: Page) =>
  page.getByRole("region", { name: "Team spend", exact: true });

async function open(page: Page, path: string) {
  await page.goto(path);
  await waitForHydration(page);
}

// Project standard (accessibility.spec.ts): WCAG 2 A/AA, serious or critical.
async function expectNoBlockingViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target.join(" ")),
      })),
  ).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${label} overflows horizontally`,
  ).toBeLessThanOrEqual(overflow.clientWidth);
}

test.describe("Team usage (unit M2, MI-D7)", () => {
  test("an admin sees the description and the Team spend region with the LiteLLM-reported badge, picks a team, and Back returns to the previous team (history push)", async ({
    page,
    context,
  }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await stubTeamDetail(page);
    await open(page, `${TEAM_USAGE}?team=${PAYMENTS}`);

    await expect(
      page.getByText("LiteLLM-reported spend for your teams"),
    ).toBeVisible();
    await expect(spendRegion(page)).toBeVisible();
    await expect(
      page.getByText("LiteLLM-reported", { exact: true }),
    ).toBeVisible();
    await expect(picker(page)).toHaveValue(PAYMENTS);

    await picker(page).selectOption({ label: "Platform" });
    await expect(page).toHaveURL(new RegExp(`[?&]team=${PLATFORM}(&|$)`));
    await expect(picker(page)).toHaveValue(PLATFORM);
    await expect(spendRegion(page)).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`[?&]team=${PAYMENTS}(&|$)`));
    await expect(picker(page)).toHaveValue(PAYMENTS);
    expect(errors).toEqual([]);
  });

  test("a linked team shows the LiteLLM team figure with its budget bar, and a global reader also the member sum, requested with include=memberSum (AT6)", async ({
    page,
    context,
  }) => {
    const seen: string[] = [];
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await stubTeamDetail(page, seen);
    await open(page, `${TEAM_USAGE}?team=${PAYMENTS}`);

    const spend = spendRegion(page);
    await expect(spend).toContainText("$321.75");
    await expect(spend).toContainText("LiteLLM team");
    await expect(spend).toContainText("Sum of members");
    await expect(spend).toContainText("$250.00");
    await expect(spend.getByRole("progressbar")).toBeVisible();
    await expect(spend).toContainText("64%");
    expect(seen.some((s) => s.includes("include=memberSum"))).toBe(true);
  });

  test("the seeded created team (no AWS account, no LiteLLM team) is in the picker and shows the member sum with 'not in LiteLLM' in text (AT4)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await stubTeamDetail(page);
    await open(page, `${TEAM_USAGE}?team=${PAYMENTS}`);

    await picker(page).selectOption({ label: "Platform Guild" });
    await expect(page).toHaveURL(new RegExp(`[?&]team=${GUILD}(&|$)`));
    const spend = spendRegion(page);
    await expect(spend).toContainText("Sum of members");
    await expect(spend).toContainText("3 matched");
    await expect(spend.getByRole("row", { name: /Tres Three/ })).toContainText(
      "not in LiteLLM",
    );
    await expect(spend.getByRole("row", { name: /Cuatro Four/ })).toContainText(
      "Hidden until per-user reporting is approved",
    );
    await expectNoBlockingViolations(page);
  });

  test("an auditor, a global reader, may open any team by URL (T-MI4)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await stubTeamDetail(page);
    const response = await page.goto(`${TEAM_USAGE}?team=${GUILD}`);
    expect(response?.status()).toBe(200);
    await waitForHydration(page);
    await expect(spendRegion(page)).toBeVisible();
  });

  test("a team that does not exist is the 404 page for a global reader too (T-MI4)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    const response = await page.goto(`${TEAM_USAGE}?team=no-such-team`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/this page could not be found/i)).toBeVisible();
  });

  // Design System - Component Inventory, NativeSelect, T-FX8: a caller's width
  // class bounds the chevron too (review FX2 r1, B1).
  for (const width of [375, 1440] as const) {
    test(`the Team picker's chevron sits inside the select, 8px or more from its right edge, at ${width}px (T-FX8)`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await stubTeamDetail(page);
      await open(page, `${TEAM_USAGE}?team=${PAYMENTS}`);
      const select = picker(page);
      await expect(select).toBeVisible();
      const chevron = select.locator("xpath=..").locator("svg");
      await expect(chevron).toHaveCount(1);
      const s = await select.boundingBox();
      const c = await chevron.boundingBox();
      expect(s).not.toBeNull();
      expect(c).not.toBeNull();
      if (s === null || c === null) return;
      expect(c.x).toBeGreaterThanOrEqual(s.x);
      expect(c.y).toBeGreaterThanOrEqual(s.y);
      expect(c.y + c.height).toBeLessThanOrEqual(s.y + s.height);
      expect(s.x + s.width - (c.x + c.width)).toBeGreaterThanOrEqual(8);
    });
  }

  for (const width of [375, 1440] as const) {
    test(`has no serious or critical axe violations and no horizontal scroll at ${width}px (Rule 40.6; accessibility.spec.ts)`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await stubTeamDetail(page);
      await open(page, `${TEAM_USAGE}?team=${PAYMENTS}`);
      await expect(spendRegion(page)).toContainText("$321.75");
      await expectNoHorizontalScroll(page, `Team usage at ${width}px`);
      await expectNoBlockingViolations(page);
    });
  }
});
