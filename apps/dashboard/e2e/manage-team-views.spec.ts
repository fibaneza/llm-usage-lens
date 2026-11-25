import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Slice B2b. Sources: Design System -- Management pages, *Team page views and
// links* (view tabs Members / Budgets / Keys on the one Tabs component with
// `?view=` URL state and history push, "so Back steps through views"; G1 -- a
// "Daily spend" action on each LiteLLM member row, read through the existing
// GET /api/litellm/users/[litellmUserId] for the URL range; G2 -- each App teams
// row links its name to /dashboard/manage/team/<id>), *Tabs vs secondary
// navigation*; LiteLLM spec LD23 (per-user daily spend, cap), LD37. Component
// behaviour (tab contents, fallbacks, unlinked rule, search, link markup) lives
// in TeamPageContent.test.tsx, MembersPanel.test.tsx and
// OrganisationSection.test.tsx (Rule 60.24a); this covers what only a browser
// shows: the History API (Back), the real shell and the real requests. The
// harness cannot forge a team-scope Lead (its scope lives in DynamoDB), so
// internal-org-admin stands in for the Lead on the Team page, as in
// manage-team.spec.ts. The LiteLLM API is fulfilled from fixtures (Rule 60.24).
// team-payments is a seeded registry team: an unknown team id is 404 (unit TM1).
const TEAM_URL = "/dashboard/manage/team/team-payments";
const DAILY = [
  { date: "2026-11-02", spend: 1.25 },
  { date: "2026-11-03", spend: 2.5 },
];
const OPS = ["getUserDailySpend", "resetMemberSpend"];

async function mockApi(page: Page) {
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/litellm\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    const ok = (data: unknown) =>
      route.fulfill({ status: 200, json: { data } });
    switch (`${route.request().method()} ${path}`) {
      case "GET /api/litellm/me":
        return ok({
          linked: false,
          enabledOperations: OPS,
          teams: [
            {
              teamId: "team-payments",
              teamName: "Payments",
              linked: true,
              configurable: true,
            },
          ],
        });
      case "GET /api/litellm/teams/team-payments":
        return ok({
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
          daily: [],
          enabledOperations: OPS,
        });
      case "GET /api/litellm/teams/team-payments/members":
        return ok({
          connected: true,
          items: [
            {
              userId: "u-ada",
              oid: "oid-ada",
              name: "Ada Lovelace",
              email: "ada@example.test",
              spend: 77.1,
              maxBudget: 150,
              rpmLimit: null,
              tpmLimit: null,
            },
          ],
        });
      case "GET /api/litellm/teams/team-payments/keys":
        return ok({ connected: true, items: [] });
      case "GET /api/litellm/models":
        return ok({ items: ["claude-sonnet"] });
      case "GET /api/litellm/users/u-ada":
        return ok({
          userId: "u-ada",
          email: "ada@example.test",
          spend: 77.1,
          maxBudget: 150,
          daily: DAILY,
          enabledOperations: ["getUserDailySpend"],
        });
      case "GET /api/litellm/org":
        return ok({
          configured: true,
          totals: { spend: 321.75 },
          enabledOperations: [],
          daily: [],
          litellmTeams: [],
          appTeams: [
            {
              teamId: "team-payments",
              teamName: "Payments",
              spendSource: "litellm-team",
              spend: 321.75,
            },
          ],
        });
      default:
        return route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "not found" } },
        });
    }
  });
}

test.describe("Team page view tabs (Team page views and links)", () => {
  test("choosing tabs records the view in the URL and Back steps through the views", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await page.goto(TEAM_URL);
    await waitForHydration(page);

    const members = page.getByRole("tab", { name: "Members" });
    const budgets = page.getByRole("tab", { name: "Budgets" });
    const keys = page.getByRole("tab", { name: "Keys" });
    await expect(members).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("region", { name: "LiteLLM members" }),
    ).toBeVisible();

    await budgets.click();
    await expect(page).toHaveURL(/[?&]view=budgets(&|$)/);
    await expect(
      page.getByRole("region", { name: "Budget and limits" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "LiteLLM members" }),
    ).toHaveCount(0);

    await keys.click();
    await expect(page).toHaveURL(/[?&]view=keys(&|$)/);
    await expect(page.getByRole("region", { name: "Models" })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/[?&]view=budgets(&|$)/);
    await expect(budgets).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("region", { name: "Budget and limits" }),
    ).toBeVisible();

    await page.goBack();
    await expect(members).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("region", { name: "LiteLLM members" }),
    ).toBeVisible();
  });
});

test.describe("Team page view tabs at 375 (review B1)", () => {
  // Rule 40.6: 44px touch targets below md (PageTabs).
  test("each view tab is at least 44px tall", async ({ page, context }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(TEAM_URL);
    await waitForHydration(page);

    const tabs = page
      .getByRole("tablist", { name: "Team views" })
      .getByRole("tab");
    await expect(tabs).toHaveCount(3);
    for (const tab of await tabs.all()) {
      const box = await tab.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("Team page member daily spend (G1)", () => {
  test("a member row opens that member's daily spend for the selected range through the existing user route", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await page.goto(`${TEAM_URL}?dateFrom=2026-11-01&dateTo=2026-11-14`);
    await waitForHydration(page);

    const asked = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/litellm/users/u-ada" &&
        url.searchParams.get("dateFrom") === "2026-11-01" &&
        url.searchParams.get("dateTo") === "2026-11-14"
      );
    });
    await page
      .getByRole("button", { name: "Daily spend for Ada Lovelace" })
      .click();
    await asked;

    const table = page.getByRole("table", { name: "Daily spend by UTC day" });
    await expect(table).toBeVisible();
    await expect(table).toContainText("2026-11-03");
    await expect(table).toContainText("$2.50");
  });
});

test.describe("Organisation to Team (G2)", () => {
  // T-LP2 (Design System - LiteLLM team page): the App teams table is gone; a
  // linked app team's name in the LiteLLM teams table links to its team page.
  test("an org-admin opens a team from the LiteLLM teams table", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    // Registered after mockApi, so it wins over the catch-all.
    await page.route(/\/api\/litellm\/org(\?|$)/, (route) =>
      route.fulfill({
        json: {
          data: {
            configured: true,
            totals: { spend: 321.75 },
            enabledOperations: [],
            daily: [],
            litellmTeams: [
              {
                litellmTeamId: "ll-1",
                alias: "Payments LLM",
                spend: 321.75,
                maxBudget: null,
                memberCount: 1,
                linkedAppTeam: {
                  teamId: "team-payments",
                  teamName: "Payments",
                },
              },
            ],
            appTeams: [],
          },
        },
      }),
    );
    await page.goto("/dashboard/manage/litellm/organisation");
    await waitForHydration(page);

    await page
      .getByRole("table", { name: "LiteLLM teams" })
      .getByRole("link", { name: "Payments", exact: true })
      .click();

    await expect(page).toHaveURL(/\/dashboard\/manage\/team\/team-payments$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Team management" }),
    ).toBeVisible();
  });
});
