import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System - LiteLLM team page (unit LP1, D-R3-7, D-R3-9), T-LP4
// and T-LP5: "/dashboard/manage/litellm/teams/[litellmTeamId], for
// internal-admin, internal-org-admin and internal-auditor; anyone else, and an
// unknown id, gets the missing page. It shows: alias and id; spend and budget
// with a BudgetBar and the budget's reset time; the models; the members ...;
// and the linked app team with its lead names ... A breadcrumb leads back to
// the tab"; "E2E per reading role; axe at 375px and desktop"; Rule 40.6. The
// API is fulfilled from fixtures (Rule 60.24).
//
// A real team Lead cannot be forged in the default project (Lead scope lives in
// DynamoDB; see manage-team.spec.ts). A signed-in internal-viewer has no
// `litellm` flag either, which is the same refusal path as a Lead (the page
// test covers the flag), so it stands in here; no probe identity is needed.
const TEAMS_TAB = "/dashboard/manage/litellm/teams";
const TEAM_PAGE = `${TEAMS_TAB}/ll-111`;

const TEAM = {
  litellmTeamId: "ll-111",
  alias: "Alpha",
  spend: 321.75,
  maxBudget: 500,
  budgetResetAt: "2026-12-01T00:00:00Z",
  memberCount: 2,
  models: ["claude-sonnet", "claude-haiku"],
  enabledOperations: ["getTeam", "resetMemberSpend", "resetMemberBudget"],
  linkedAppTeam: {
    teamId: "payments",
    name: "Payments",
    leads: [{ name: "Grace Hopper" }],
  },
};
const MEMBERS = {
  litellmTeamId: "ll-111",
  enabledOperations: ["resetMemberSpend", "resetMemberBudget"],
  items: [
    {
      userId: "ll-ada",
      email: "ada@example.test",
      spend: 6,
      maxBudget: 10,
      person: { oid: "oid-ada", name: "Ada Lovelace" },
    },
    {
      userId: "ll-zed",
      email: "zed@example.test",
      spend: 2,
      maxBudget: null,
      person: null,
    },
  ],
};

async function mockApi(page: Page, team: unknown = TEAM) {
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/accounts(\?|$)/, (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route(/\/api\/access\/org-units(\?|$)/, (route) =>
    route.fulfill({ json: { data: { teams: [], departments: [] } } }),
  );
  await page.route(/\/api\/litellm\/toggles$/, (route) =>
    route.fulfill({
      json: {
        data: { version: 0, edition: "oss", ssoEnabled: false, operations: {} },
      },
    }),
  );
  await page.route(/\/api\/litellm\/team-links(\?|$)/, (route) =>
    route.fulfill({
      json: {
        data: {
          items: [],
          appTeams: [],
          configured: true,
          litellmTeams: [{ litellmTeamId: "ll-111", alias: "Alpha" }],
        },
      },
    }),
  );
  await page.route(/\/api\/litellm\/proxy-teams\/ll-111$/, (route) =>
    route.fulfill({ json: { data: team } }),
  );
  await page.route(/\/api\/litellm\/proxy-teams\/ll-111\/members$/, (route) =>
    route.fulfill({ json: { data: MEMBERS } }),
  );
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => v.id),
  ).toEqual([]);
}

test.describe("LiteLLM team page (LP1, T-LP4, T-LP5)", () => {
  for (const role of [
    "internal-admin",
    "internal-org-admin",
    "internal-auditor",
  ]) {
    test(`${role}: opens a team from the teams tab and sees the summary, the members and the link panel`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      await mockApi(page);
      await page.goto(TEAMS_TAB);
      await waitForHydration(page);

      await page
        .getByRole("table", { name: "LiteLLM teams" })
        .getByRole("link", { name: "Alpha" })
        .click();
      await expect(page).toHaveURL(new RegExp(`${TEAM_PAGE}$`));

      const summary = page.getByRole("region", { name: "Summary" });
      await expect(summary).toContainText("Alpha");
      await expect(summary).toContainText("ll-111");
      await expect(summary).toContainText("$321.75");
      await expect(summary.getByRole("progressbar")).toBeVisible();
      await expect(summary).toContainText("claude-sonnet");
      await expect(
        page
          .getByRole("region", { name: "Members" })
          .getByRole("table", { name: "Members of Alpha" }),
      ).toContainText("ada@example.test");
      const link = page.getByRole("region", { name: "Linked dashboard team" });
      await expect(link).toContainText("Payments");
      await expect(link).toContainText("Grace Hopper");

      const reset = page.getByRole("button", {
        name: "Reset spend for Ada Lovelace",
      });
      await expect(reset).toHaveCount(role === "internal-auditor" ? 0 : 1);

      await page
        .getByRole("link", { name: "LiteLLM teams", exact: true })
        .first()
        .click();
      await expect(page).toHaveURL(new RegExp(`${TEAMS_TAB}$`));
    });
  }

  // T-LP5 (Design System - LiteLLM team page): the name is a real link, so
  // the keyboard opens the page (WCAG 2.1.1).
  test("the keyboard opens a team: focus the name link on the teams tab and press Enter", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page);
    await page.goto(TEAMS_TAB);
    await waitForHydration(page);
    const link = page
      .getByRole("table", { name: "LiteLLM teams" })
      .getByRole("link", { name: "Alpha" });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${TEAM_PAGE}$`));
    await expect(page.getByRole("region", { name: "Summary" })).toContainText(
      "Alpha",
    );
  });

  test("an unlinked team says 'Not linked to a dashboard team'", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page, { ...TEAM, linkedAppTeam: null });
    await page.goto(TEAM_PAGE);
    await waitForHydration(page);
    await expect(
      page.getByRole("region", { name: "Linked dashboard team" }),
    ).toContainText("Not linked to a dashboard team");
  });

  test("a Lead or a user (no litellm flag) gets the missing page and no LiteLLM request", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    const seen: string[] = [];
    await page.route(/\/api\/litellm\//, (route) => {
      seen.push(route.request().url());
      return route.fulfill({ json: { data: {} } });
    });
    const response = await page.goto(TEAM_PAGE);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("region", { name: "Summary" })).toHaveCount(0);
    expect(seen).toEqual([]);
  });

  test("an unknown tab under the area is the missing page", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    const response = await page.goto(
      "/dashboard/manage/litellm/organisation/ll-111",
    );
    expect(response?.status()).toBe(404);
  });

  for (const [label, size] of [
    ["375px", { width: 375, height: 800 }],
    ["desktop", { width: 1440, height: 900 }],
  ] as const) {
    test(`axe-clean with no horizontal scroll at ${label}`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await mockApi(page);
      await page.setViewportSize(size);
      await page.goto(TEAM_PAGE);
      await waitForHydration(page);
      await expect(
        page.getByRole("region", { name: "Linked dashboard team" }),
      ).toContainText("Grace Hopper");
      await expect(page.getByText("ada@example.test")).toBeVisible();
      await expectNoSeriousAxe(page);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
    });
  }
});
