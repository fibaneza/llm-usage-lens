import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Source: Design System - LiteLLM client requests (unit FX1; D-R3-16,
// D-R3-18), T-FX5: on the LiteLLM users tab, clicking a user opens the user
// page (LP2, T-LP9: the in-place detail is removed) and choosing "Members of
// one team" lists the teams, with no alert. T-LP6: the search hint and the
// empty state. The user
// detail and org routes require dateFrom and dateTo (DateRangeQuerySchema), so
// their stubs answer 400 in the standard error shape without them (Rule 60.24:
// fulfilled from fixtures, no real LiteLLM).
const PATH = "/dashboard/manage/litellm/users";
const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-03";

const noRange = (url: URL) =>
  !(url.searchParams.has("dateFrom") && url.searchParams.has("dateTo"));

const refused = {
  status: 400,
  json: {
    error: {
      code: "BAD_REQUEST",
      message: "dateFrom and dateTo are required",
    },
  },
};

async function mockApi(page: Page) {
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/litellm\//, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const data = (body: unknown) => route.fulfill({ json: { data: body } });
    if (path === "/api/litellm/users" && url.searchParams.has("q")) {
      return data({
        page: 1,
        pageSize: 25,
        enabledOperations: [],
        callerLitellmUserId: null,
        users: [],
      });
    }
    if (path === "/api/litellm/users") {
      return data({
        page: 1,
        pageSize: 25,
        enabledOperations: [],
        hasMore: false,
        users: [
          {
            key: "oid-ada",
            linkState: "linked",
            appUser: {
              oid: "oid-ada",
              displayName: "Ada Lovelace",
              email: "ada@example.test",
              version: 1,
            },
            litellmUser: {
              userId: "u-ada",
              email: "ada@example.test",
              spend: 77.1,
              maxBudget: 150,
              teams: [{ teamId: "t1", teamName: "Payments" }],
            },
          },
        ],
      });
    }
    if (path === "/api/litellm/users/u-ada") {
      if (noRange(url)) return route.fulfill(refused);
      return data({
        userId: "u-ada",
        email: "ada@example.test",
        spend: 77.1,
        maxBudget: 150,
        daily: [{ date: "2026-10-02", spend: 4.5 }],
        enabledOperations: [],
        teams: [],
        appUser: null,
      });
    }
    if (path === "/api/litellm/org") {
      if (noRange(url)) return route.fulfill(refused);
      return data({
        configured: true,
        totals: { spend: 14 },
        daily: [],
        enabledOperations: [],
        litellmTeams: [
          {
            litellmTeamId: "ll-1",
            alias: "Payments LLM",
            spend: 10,
            maxBudget: null,
            memberCount: 3,
            linkedAppTeam: { teamId: "t1", teamName: "Payments" },
          },
          {
            litellmTeamId: "ll-2",
            alias: "Shared platform",
            spend: 4,
            maxBudget: null,
            memberCount: 2,
            linkedAppTeam: null,
          },
        ],
        appTeams: [],
      });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: "NOT_FOUND", message: "not found" } },
    });
  });
}

test.describe("LiteLLM users tab requests (FX1, T-FX5)", () => {
  test.beforeEach(async ({ context, page }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await page.goto(`${PATH}?${RANGE}`);
    await waitForHydration(page);
  });

  test("T-FX5 / T-LP9: clicking a user opens the user page with the detail and no alert", async ({
    page,
  }) => {
    await page.getByRole("link", { name: "Ada Lovelace" }).click();
    await expect(page).toHaveURL(/\/dashboard\/manage\/litellm\/users\/u-ada/);
    await expect(page.getByRole("region", { name: "Summary" })).toContainText(
      "$77.10",
    );
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  });

  test("T-LP6: one character shows 'Type at least 2 characters'; a term that matches nothing shows 'No users found'", async ({
    page,
  }) => {
    const search = page.getByRole("searchbox", { name: "Search users" });
    await search.fill("a");
    await expect(page.getByText("Type at least 2 characters")).toBeVisible();
    await search.fill("zzzz");
    await expect(page.getByText("No users found")).toBeVisible();
    await expect(page.getByText("Type at least 2 characters")).toHaveCount(0);
  });

  test('"Members of one team" lists the teams with no alert', async ({
    page,
  }) => {
    await page.getByRole("radio", { name: "Members of one team" }).click();
    const picker = page.getByLabel("Team");
    await expect(
      picker.getByRole("option", { name: "Shared platform" }),
    ).toBeAttached();
    await expect(
      picker.getByRole("option", { name: "Payments LLM" }),
    ).toBeAttached();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  });
});
