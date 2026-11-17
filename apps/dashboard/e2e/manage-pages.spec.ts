import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System -- Management pages (Organisation, Users, Audit with
// the App . Gateway source toggle and its default; My usage with the LiteLLM
// view; "a source the caller may not read is not offered"), Navigation
// (Sidebar) (routes and redirects: `/dashboard/litellm?tab=` -> the matching
// Management route); LiteLLM spec -- Views by role, Cost visualisation and
// provenance (LT8), LD20; Access Control -- Navigation and landing by role
// (Hidden means absent and 404); slice B2 brief B2-3, B2-7, B2-8, B2-11. The
// LiteLLM API is fulfilled from fixtures (Rule 60.24). Behaviour detail lives
// in the component and page tests (Rule 60.24a); this covers the real shell,
// role gating, the redirects and axe. Retargeted from the retired
// litellm.spec.ts (the tab row is gone). The harness cannot forge a team-scope
// Lead (Lead scope lives in DynamoDB), so org-admin stands in where a global
// non-auditor reader is needed; the lead's rail runs in role-landing.spec.ts.
const ME = {
  linked: true,
  spend: 12.5,
  maxBudget: 100,
  daily: [{ date: "2026-11-14", spend: 4.5 }],
  keys: [],
  enabledOperations: [],
  teams: [{ teamId: "t1", teamName: "Payments", linked: true }],
};

async function mockApi(page: Page, me: unknown = ME) {
  const hits: string[] = [];
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/litellm\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    hits.push(path);
    // Like the real route, /me answers 400 without a valid UTC range (B4;
    // Rule 20.8).
    const query = new URL(route.request().url()).searchParams;
    if (
      path === "/api/litellm/me" &&
      !(query.get("dateFrom") && query.get("dateTo"))
    ) {
      return route.fulfill({
        status: 400,
        json: { error: { code: "BAD_REQUEST", message: "Invalid query" } },
      });
    }
    const body: Record<string, unknown> = {
      "/api/litellm/me": me,
      "/api/litellm/org": {
        // LD36: the total is the sum of the LiteLLM teams rows for the range.
        totals: { spend: 321.75 },
        enabledOperations: [],
        daily: [{ date: "2026-11-14", spend: 100 }],
        litellmTeams: [
          {
            litellmTeamId: "ll-1",
            alias: "Payments LLM",
            spend: 321.75,
            maxBudget: 500,
            memberCount: 7,
            linkedAppTeam: { teamId: "t1", teamName: "Payments" },
          },
        ],
        appTeams: [
          {
            teamId: "t1",
            teamName: "Payments",
            spendSource: "litellm-team",
            spend: 321.75,
          },
        ],
      },
      "/api/litellm/users": {
        page: 1,
        pageSize: 25,
        enabledOperations: [],
        users: [
          {
            userId: "u-ada",
            email: "ada@example.test",
            spend: 77.1,
            maxBudget: 150,
            teams: [{ teamId: "t1", teamName: "Payments" }],
          },
        ],
      },
      "/api/litellm/users/u-ada": {
        userId: "u-ada",
        email: "ada@example.test",
        spend: 77.1,
        maxBudget: 150,
        daily: [{ date: "2026-11-14", spend: 4.5 }],
        enabledOperations: [],
      },
      "/api/litellm/audit": {
        items: [
          {
            id: "a1",
            updatedAt: "2026-11-15T13:00:00Z",
            changedBy: "ops@example.test",
            action: "update",
            tableName: "LiteLLM_TeamTable",
            objectId: "t1",
            changedFields: ["max_budget"],
            viaDashboard: false,
          },
        ],
      },
    };
    return path in body
      ? route.fulfill({ json: { data: body[path] } })
      : route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "not found" } },
        });
  });
  return hits;
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await waitForHydration(page);
}

async function expectNoBlockingViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target.join(" ")),
      })),
  ).toEqual([]);
}

test.describe("Management -> Organisation and Users", () => {
  test("an admin sees the Organisation totals and per-team table, labelled LiteLLM-reported", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, "/dashboard/manage/organisation");

    await expect(
      page.getByRole("heading", { level: 1, name: "Organisation usage" }),
    ).toBeVisible();
    const region = page.getByRole("region", { name: "Organisation" });
    await expect(region).toContainText("Payments");
    await expect(region).toContainText("LiteLLM-reported");
    // App Teams spec - Organisation view: two tables, the second labelled.
    await expect(
      region.getByRole("table", { name: "LiteLLM teams" }),
    ).toBeVisible();
    await expect(
      region.getByRole("table", { name: "App teams" }),
    ).toBeVisible();
    await expect(region).toContainText(
      "Per app team. Rows overlap with each other and do not add up to the total.",
    );
    // L4b review round 1: axe on the populated state, both tables rendered.
    await expectNoBlockingViolations(page);
  });

  test("an org admin searches users and opens one user's spend", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await open(page, "/dashboard/manage/users");

    await expect(
      page.getByRole("heading", { level: 1, name: "User lookup" }),
    ).toBeVisible();
    await page.getByRole("searchbox", { name: /search users/i }).fill("ada");
    await page.getByRole("button", { name: "ada@example.test" }).click();
    await expect(
      page.getByRole("region", { name: /user usage/i }),
    ).toContainText("$77.10");
  });

  test("the Users page has no serious or critical axe violations", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, "/dashboard/manage/users");
    await expect(
      page.getByRole("searchbox", { name: /search users/i }),
    ).toBeVisible();

    await expectNoBlockingViolations(page);
  });
});

test.describe("Management -> Audit", () => {
  test("an admin sees the App . Gateway toggle, App by default, and the Gateway source with Sydney time", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    const hits = await mockApi(page);
    await open(page, "/dashboard/manage/audit");

    await expect(
      page.getByRole("heading", { level: 1, name: "Audit log" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "App" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "Audit log", exact: true }),
    ).toBeVisible();
    expect(hits).not.toContain("/api/litellm/audit");

    await page.getByRole("button", { name: "Gateway" }).click();
    await expect(page).toHaveURL(/source=gateway/);
    await expect(
      page.getByRole("region", { name: "LiteLLM audit" }),
    ).toContainText("AEDT");
  });

  test("an auditor opens the Audit page with both sources", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page);
    await open(page, "/dashboard/manage/audit?source=gateway");

    await expect(page.getByRole("button", { name: "Gateway" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "App" })).toBeVisible();
  });

  test("the Gateway source has no serious or critical axe violations", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, "/dashboard/manage/audit?source=gateway");
    await expect(
      page.getByRole("region", { name: "LiteLLM audit" }),
    ).toBeVisible();

    await expectNoBlockingViolations(page);
  });

  test("an org admin gets the 404 (neither audit source is readable by it)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    const hits = await mockApi(page);
    const response = await page.goto("/dashboard/manage/audit");

    expect(response?.status()).toBe(404);
    expect(hits).not.toContain("/api/litellm/audit");
  });
});

// Design System - Routes and redirects; Access Control - Hidden means absent:
// a redirect lands on the target's own gate.
test.describe("retired /dashboard/litellm redirects", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  for (const [tab, target] of [
    ["organisation", "/dashboard/manage/organisation"],
    ["users", "/dashboard/manage/users"],
    ["audit", "/dashboard/manage/audit"],
    ["team", "/dashboard/manage/team"],
  ] as const) {
    test(`?tab=${tab} lands on ${target} for an admin`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await page.goto(`/dashboard/litellm?tab=${tab}`);
      await waitForHydration(page);

      await expect(page).toHaveURL(new RegExp(`${target}(\\?|$)`));
    });
  }

  test("no tab (or my-usage) lands on My usage", async ({ page, context }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await page.goto("/dashboard/litellm");
    await waitForHydration(page);

    await expect(page).toHaveURL(/\/dashboard\/me(\?|$)/);
  });

  test("a viewer following ?tab=organisation gets the 404 at the target", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await page.goto("/dashboard/litellm?tab=organisation");

    await expect(page.getByText(/this page could not be found/i)).toBeVisible();
  });
});

// B4 + B2-11: the LiteLLM My usage view lives on My usage; the user role holds
// no Management page.
test.describe("My usage LiteLLM view and user 404s", () => {
  test("a viewer's My usage shows the LiteLLM-reported spend, not a load error, when the route needs a range (B4)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page, { ...ME, teams: [] });
    await open(page, "/dashboard/me");

    const usage = page.getByRole("region", { name: /litellm/i });
    await expect(usage).toContainText("$12.50");
    await expect(usage).not.toContainText("Couldn't load");
  });

  test("a viewer gets the 404 on every Management page and never requests LiteLLM audit", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    const hits = await mockApi(page, { ...ME, teams: [] });
    for (const path of [
      "/dashboard/manage/team",
      "/dashboard/manage/organisation",
      "/dashboard/manage/users",
      "/dashboard/manage/audit",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    expect(hits).not.toContain("/api/litellm/audit");
  });
});
