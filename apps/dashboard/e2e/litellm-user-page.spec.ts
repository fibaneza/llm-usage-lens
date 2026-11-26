import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "./support/animations";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System - LiteLLM user page (unit LP2, user, 2026-11-25:
// "in a new page, no under the user table, also if is linked to any app user
// and team"; D-R3-8, D-R3-9), T-LP8 and T-LP9: "The user cell of each row
// links to /dashboard/manage/litellm/users/[litellmUserId], for the same three
// roles ... The page shows: user id and email; spend and budget; daily spend
// for the range; the combined figure; the user's LiteLLM teams, each a link to
// its page; and the linked dashboard person with their team, or 'Not linked to
// a dashboard user'. Reset spend and Link / Unlink are there for the callers
// who have them on the tab today"; "an unknown id and a lead get the missing
// page"; T-LP5-style: "E2E per reading role; axe at 375px and desktop";
// Rule 40.6. The API is fulfilled from fixtures (Rule 60.24).
//
// A real team Lead cannot be forged in the default project (Lead scope lives in
// DynamoDB); a signed-in internal-viewer has no `litellm` flag either, which is
// the same refusal path (the page test covers the flag), so it stands in here.
const USERS_TAB = "/dashboard/manage/litellm/users";
const USER_PAGE = `${USERS_TAB}/u-ada`;
const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-31";

const USER = {
  userId: "u-ada",
  email: "ada@example.test",
  spend: 77.1,
  maxBudget: 150,
  daily: Array.from({ length: 31 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, "0")}`,
    spend: 1 + (i % 4),
    requests: 10 * (1 + (i % 4)),
    tokens: 1000 * (1 + (i % 4)),
  })),
  enabledOperations: ["resetMemberSpend", "resetUserSpend"],
  teams: [
    {
      litellmTeamId: "ll-111",
      alias: "Payments LLM",
      appTeam: { teamId: "payments", name: "Payments" },
    },
  ],
  appUser: {
    oid: "oid-ada",
    name: "Ada Lovelace",
    email: "ada@example.test",
    appTeam: { teamId: "payments", name: "Payments" },
  },
};

const noRange = (url: URL) =>
  !(url.searchParams.has("dateFrom") && url.searchParams.has("dateTo"));

async function mockApi(
  page: Page,
  user: unknown = USER,
  userId: string = USER.userId,
) {
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/accounts(\?|$)/, (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route(/\/api\/access\/org-units(\?|$)/, (route) =>
    route.fulfill({ json: { data: { teams: [], departments: [] } } }),
  );
  await page.route(/\/api\/identities\/oid-ada$/, (route) =>
    route.fulfill({
      json: {
        data: {
          oid: "oid-ada",
          displayName: "Ada Lovelace",
          email: "ada@example.test",
          upn: null,
          authMethod: "entra",
          createdAt: null,
          lastSignInAt: null,
          memberTeamId: "payments",
          memberVersion: 1,
          leadScopes: [],
          litellm: { state: "linked", litellmUserId: "u-ada" },
          linkVersion: 3,
          allowed: {
            editDisplayName: false,
            linkLiteLLM: true,
            unlinkLiteLLM: true,
            resetSpend: true,
            changeMembership: false,
            changeLead: false,
            editRoles: false,
            editUsageIdentities: false,
          },
        },
      },
    }),
  );
  await page.route(/\/api\/litellm\/users\/[^/]+\/memberships$/, (route) =>
    route.fulfill({ json: { data: { items: [], configured: true } } }),
  );
  await page.route(/\/api\/litellm\/users(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        data: {
          page: 1,
          pageSize: 25,
          hasMore: false,
          enabledOperations: ["resetMemberSpend", "resetUserSpend"],
          mayLink: true,
          users: [
            {
              key: "oid-ada",
              linkState: "linked",
              appUser: {
                oid: "oid-ada",
                displayName: "Ada Lovelace",
                email: "ada@example.test",
                version: 3,
              },
              litellmUser: {
                userId: "u-ada",
                email: "ada@example.test",
                spend: 77.1,
                maxBudget: 150,
                teams: [{ teamId: "payments", teamName: "Payments" }],
              },
            },
          ],
        },
      },
    }),
  );
  await page.route(
    new RegExp(`/api/litellm/users/${userId}(\\?.*)?$`),
    (route) => {
      const url = new URL(route.request().url());
      if (noRange(url)) {
        return route.fulfill({
          status: 400,
          json: {
            error: {
              code: "BAD_REQUEST",
              message: "dateFrom and dateTo are required",
            },
          },
        });
      }
      return route.fulfill({ json: { data: user } });
    },
  );
}

async function expectNoSeriousAxe(page: Page) {
  await waitForAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => v.id),
  ).toEqual([]);
}

test.describe("LiteLLM user page (LP2, T-LP8, T-LP9)", () => {
  for (const role of [
    "internal-admin",
    "internal-org-admin",
    "internal-auditor",
  ]) {
    test(`${role}: opens a user from the tab and sees the identity, the teams and the linked person`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      await mockApi(page);
      await page.goto(`${USERS_TAB}?${RANGE}`);
      await waitForHydration(page);

      await page
        .getByRole("table", { name: "LiteLLM users" })
        .getByRole("link", { name: "Ada Lovelace" })
        .click();
      await expect(page).toHaveURL(new RegExp(`${USER_PAGE}(\\?.*)?$`));
      // T-LP9: nothing renders under the table; the detail is on the page.
      await expect(
        page.getByRole("region", { name: /user usage/i }),
      ).toHaveCount(0);

      const summary = page.getByRole("region", { name: "Summary" });
      await expect(summary).toContainText("u-ada");
      await expect(summary).toContainText("ada@example.test");
      await expect(summary).toContainText("$77.10");
      await expect(summary).toContainText("$150.00");
      await expect(
        page.getByRole("region", { name: "Spend over time" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "LiteLLM teams" })
          .getByRole("link", { name: "Payments LLM" }),
      ).toHaveAttribute("href", "/dashboard/manage/litellm/teams/ll-111");
      const linked = page.getByRole("region", {
        name: "Linked dashboard user",
      });
      await expect(
        linked.getByRole("link", { name: "Ada Lovelace" }),
      ).toHaveAttribute("href", "/dashboard/manage/users/oid-ada");
      await expect(linked).toContainText("Payments");

      const reset = page.getByRole("button", {
        name: "Reset spend for Ada Lovelace",
      });
      await expect(reset).toHaveCount(role === "internal-auditor" ? 0 : 1);

      await page
        .getByRole("link", { name: "LiteLLM users", exact: true })
        .first()
        .click();
      await expect(page).toHaveURL(new RegExp(`${USERS_TAB}(\\?.*)?$`));
    });
  }

  // T-LP17 (Design System - LiteLLM user page, name and spend over time): for
  // the three reading roles, the breadcrumb name, the chart, Weekly by click.
  // The name is the id here (no connection is stored, so the page's check makes
  // no call; the alias and email cases are the page test's, T-LP13); the full
  // value is in `title`.
  for (const role of [
    "internal-admin",
    "internal-org-admin",
    "internal-auditor",
  ]) {
    test(`T-LP17 ${role}: the breadcrumb names the user, the chart shows, Weekly by click`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      await mockApi(page);
      await page.goto(`${USER_PAGE}?${RANGE}`);
      await waitForHydration(page);

      const crumb = page
        .getByRole("navigation", { name: "breadcrumb" })
        .locator('[aria-current="page"]');
      await expect(crumb).toBeVisible();
      await expect(crumb).not.toHaveText("");
      const title = await crumb.evaluate((el) => el.getAttribute("title"));
      expect(title).toBe(await crumb.innerText());

      const region = page.getByRole("region", { name: "Spend over time" });
      await expect(
        region.getByRole("img", {
          name: /Spend, 2026-10-01 to 2026-10-31 UTC/,
        }),
      ).toBeVisible();
      await expect(
        region.getByText("Daily spend", { exact: true }),
      ).toBeVisible();
      await region.getByRole("button", { name: "Weekly" }).click();
      await expect(
        region.getByRole("button", { name: "Weekly" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page).toHaveURL(/bucket=weekly/);
      await expect(
        region.getByText("Weekly spend", { exact: true }),
      ).toBeVisible();
    });
  }

  // T-LP13 / Rule 40.6 (Design System - LiteLLM user page): a long id (no
  // alias, so the crumb shows the id) truncates inside the crumb at 375px;
  // the page does not scroll sideways and the full value is in `title`.
  test("T-LP13: a long user id truncates in the last crumb at 375px without a sideways scroll", async ({
    page,
    context,
  }) => {
    const longId = `u-${"x".repeat(118)}`;
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page, { ...USER, userId: longId }, longId);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`${USERS_TAB}/${longId}?${RANGE}`);
    await waitForHydration(page);

    const crumb = page
      .getByRole("navigation", { name: "breadcrumb" })
      .locator('[aria-current="page"]');
    await expect(crumb).toHaveAttribute("title", longId);
    expect(await crumb.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      true,
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  // T-LP9: the user cell is a real link, so the keyboard opens the page
  // (WCAG 2.1.1).
  test("the keyboard opens a user: focus the user link on the tab and press Enter", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page);
    await page.goto(`${USERS_TAB}?${RANGE}`);
    await waitForHydration(page);
    const link = page
      .getByRole("table", { name: "LiteLLM users" })
      .getByRole("link", { name: "Ada Lovelace" });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${USER_PAGE}(\\?.*)?$`));
    await expect(page.getByRole("region", { name: "Summary" })).toContainText(
      "ada@example.test",
    );
  });

  test("T-LP8: a user linked to no dashboard user says 'Not linked to a dashboard user'", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page, { ...USER, appUser: null, teams: [] });
    await page.goto(`${USER_PAGE}?${RANGE}`);
    await waitForHydration(page);
    await expect(
      page.getByRole("region", { name: "Linked dashboard user" }),
    ).toContainText("Not linked to a dashboard user");
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
    const response = await page.goto(`${USER_PAGE}?${RANGE}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("region", { name: "Summary" })).toHaveCount(0);
    expect(seen).toEqual([]);
  });

  for (const [label, size] of [
    ["375px", { width: 375, height: 800 }],
    ["desktop", { width: 1440, height: 900 }],
  ] as const) {
    test(`axe-clean with no horizontal scroll at ${label}, with the page loaded`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await mockApi(page);
      await page.setViewportSize(size);
      await page.goto(`${USER_PAGE}?${RANGE}`);
      await waitForHydration(page);
      await expect(
        page.getByRole("region", { name: "Linked dashboard user" }),
      ).toContainText("Ada Lovelace");
      await expect(page.getByRole("region", { name: "Summary" })).toContainText(
        "$77.10",
      );
      await expect(
        page
          .getByRole("region", { name: "Spend over time" })
          .getByRole("img", { name: /^Spend, / }),
      ).toBeVisible();
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
