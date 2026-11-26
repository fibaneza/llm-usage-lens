import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

import { waitForAnimations } from "./support/animations";
import { expectNoBlockingViolations } from "./support/axe";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System -- LiteLLM Organisation spend chart (unit OC1,
// T-OC7): "E2E for internal-admin, internal-org-admin and internal-auditor:
// the chart is shown; By team and Table by click; axe clean at 375px and
// desktop in both views; no horizontal page scroll at 375px"; T-OC5 and
// T-OC6 (the four tiles); Rule 40.6
// (breakpoints), LD20 (UTC days). The LiteLLM API is fulfilled from fixtures
// (Rule 60.24); the answer has nine teams over a 30-day range.
const ORGANISATION = "/dashboard/manage/litellm/organisation";
const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-30";

const DAYS = Array.from(
  { length: 30 },
  (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`,
);
const TEAMS = Array.from({ length: 9 }, (_, i) => {
  const n = i + 1;
  return {
    litellmTeamId: `ll-${n}`,
    alias: `Team ${n}`,
    daily: DAYS.map((date, d) => ({
      date,
      spend: n * (1 + (d % 5)),
      requests: n * 10 * (1 + (d % 5)),
      tokens: n * 1000 * (1 + (d % 5)),
    })),
  };
});
const ORG = {
  configured: true,
  totals: {
    spend: TEAMS.flatMap((t) => t.daily).reduce((a, r) => a + r.spend, 0),
    requests: TEAMS.flatMap((t) => t.daily).reduce((a, r) => a + r.requests, 0),
    tokens: TEAMS.flatMap((t) => t.daily).reduce((a, r) => a + r.tokens, 0),
    successfulRequests:
      TEAMS.flatMap((t) => t.daily).reduce((a, r) => a + r.requests, 0) - 3,
    failedRequests: 3,
  },
  daily: DAYS.map((date, d) => ({
    date,
    spend: 45 * (1 + (d % 5)),
    requests: 450 * (1 + (d % 5)),
    tokens: 45_000 * (1 + (d % 5)),
  })),
  dailyByTeam: TEAMS,
  enabledOperations: [],
  litellmTeams: TEAMS.map((t) => ({
    litellmTeamId: t.litellmTeamId,
    alias: t.alias,
    spend: t.daily.reduce((a, r) => a + r.spend, 0),
    requests: t.daily.reduce((a, r) => a + r.requests, 0),
    tokens: t.daily.reduce((a, r) => a + r.tokens, 0),
    maxBudget: null,
    memberCount: 2,
    linkedAppTeam: null,
  })),
  appTeams: [],
};

async function mockApi(page: Page) {
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/access\/org-units(\?|$)/, (route) =>
    route.fulfill({ json: { data: { teams: [], departments: [] } } }),
  );
  await page.route(/\/api\/litellm\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/litellm/org") {
      return route.fulfill({ json: { data: ORG } });
    }
    if (path === "/api/litellm/toggles") {
      return route.fulfill({
        json: {
          data: {
            version: 0,
            edition: "oss",
            ssoEnabled: false,
            operations: {},
          },
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: "NOT_FOUND", message: "not found" } },
    });
  });
}

// A switch option is an aria-pressed toggle button (Design System -- How OC1
// builds it).
const option = (page: Page, name: string, pressed?: boolean): Locator =>
  page.getByRole("button", { name, exact: true, pressed });

async function choose(page: Page, name: string) {
  await option(page, name).click();
  await expect(option(page, name, true)).toBeVisible();
}

async function expectNoSidewaysScroll(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

async function expectAxeClean(page: Page) {
  await waitForAnimations(page);
  await expectNoBlockingViolations(page);
}

async function openOrganisation(
  page: Page,
  context: BrowserContext,
  role: string,
) {
  await signInAsTestUser(context, { roles: [role] });
  await mockApi(page);
  await page.goto(`${ORGANISATION}?${RANGE}`);
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: "Spend over time" }),
  ).toBeVisible();
}

const ROLES = ["internal-admin", "internal-org-admin", "internal-auditor"];

test.describe("LiteLLM Organisation spend chart (OC1, T-OC7)", () => {
  for (const role of ROLES) {
    test(`${role}: chart view, tiles, By team, desktop and 375px`, async ({
      page,
      context,
    }) => {
      await openOrganisation(page, context, role);

      // T-OC5, T-OC6: the four tiles, before the panel.
      for (const title of [
        "Total spend",
        "Requests",
        "Tokens",
        "Average cost per request",
      ]) {
        await expect(
          page
            .getByText(title, { exact: true })
            .and(page.locator(":not(button)"))
            .first(),
        ).toBeVisible();
      }
      await expect(option(page, "Chart", true)).toBeVisible();
      await expect(
        page.getByRole("img", { name: /spend/i }).first(),
      ).toBeVisible();
      await expectAxeClean(page);

      await choose(page, "By team");
      await expect(
        page.getByRole("list", { name: "Chart legend" }),
      ).toContainText("Other teams");
      await expectAxeClean(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await expectNoSidewaysScroll(page);
      await expectAxeClean(page);

      await page.setViewportSize({ width: 375, height: 812 });
      await expectNoSidewaysScroll(page);
      await expectAxeClean(page);
    });

    test(`${role}: table view, back to chart, desktop and 375px`, async ({
      page,
      context,
    }) => {
      await openOrganisation(page, context, role);

      await choose(page, "Table");
      await expect(
        page.getByRole("columnheader", { name: "Date (UTC)" }),
      ).toBeVisible();
      await expectAxeClean(page);

      await page.setViewportSize({ width: 375, height: 812 });
      await expectNoSidewaysScroll(page);
      await expectAxeClean(page);

      await choose(page, "Chart");
      await expect(
        page.getByRole("img", { name: /spend/i }).first(),
      ).toBeVisible();
      await expectNoSidewaysScroll(page);
      await expectAxeClean(page);
    });
  }

  // Design System -- LiteLLM Organisation spend chart, the 2026-11-26
  // comparison (T-OC13): Weekly by click for the three reading roles; axe at
  // 375px and desktop. The range 1-30 Oct 2026 starts on a Thursday, so its
  // first and last weeks are part weeks.
  for (const role of ROLES) {
    test(`${role}: Weekly by click shows week labels; axe clean at desktop and 375px (T-OC13)`, async ({
      page,
      context,
    }) => {
      await openOrganisation(page, context, role);

      await choose(page, "Weekly");
      await expect(page).toHaveURL(/bucket=weekly/);
      await expect(
        page
          .locator(".recharts-xAxis-tick-labels")
          .getByText(/^Week of /)
          .first(),
      ).toBeVisible();
      await expect(
        page.getByText("Weekly spend", { exact: true }),
      ).toBeVisible();
      await expectAxeClean(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(
        page.getByRole("columnheader", { name: "Share" }),
      ).toBeVisible();
      await expectNoSidewaysScroll(page);
      await expectAxeClean(page);

      await page.setViewportSize({ width: 375, height: 812 });
      await expectNoSidewaysScroll(page);
      await expectAxeClean(page);
    });
  }
});
