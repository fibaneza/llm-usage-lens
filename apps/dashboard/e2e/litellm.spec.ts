import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: docs/specs/2026-11-10-litellm.md -- Page and Settings, Roles and
// rights, Cost visualisation and provenance (LT8), LD20; implementation-phases
// L3 ("e2e probe, fake"). The LiteLLM API is fulfilled from fixtures
// (Rule 60.24). Behaviour detail lives in the component tests (Rule 60.24a);
// this covers the real shell, role gating and axe. L3b (Views by role): the
// page is tabs (?tab=); Admin sees all five, org-admin everything but Audit
// (the harness cannot forge a team-scope Lead: Lead scope lives in DynamoDB, so
// org-admin stands in for the Team + Users case), a Viewer only My usage.
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
      "/api/litellm/teams/t1": {
        connected: true,
        team: {
          alias: "Payments",
          spend: 321.75,
          maxBudget: 500,
          softBudget: 400,
          budgetDuration: "30d",
          models: ["claude-sonnet"],
          rpmLimit: null,
          tpmLimit: null,
        },
        daily: [{ date: "2026-11-14", spend: 40 }],
        enabledOperations: [],
      },
      "/api/litellm/teams/t1/members": {
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
      },
      "/api/litellm/teams/t1/keys": { connected: true, items: [] },
      "/api/litellm/org": {
        totals: { spend: 1234.5 },
        enabledOperations: [],
        daily: [{ date: "2026-11-14", spend: 100 }],
        teams: [
          {
            teamId: "t1",
            teamName: "Payments",
            spend: 321.75,
            maxBudget: 500,
            memberCount: 7,
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

async function openPage(page: Page) {
  await page.goto("/dashboard/litellm");
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "LiteLLM usage & administration",
    }),
  ).toBeVisible();
}

test.describe("LiteLLM page", () => {
  test("renders every section for an Admin, labelled LiteLLM-reported, with Sydney time", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await openPage(page);

    await expect(page.getByRole("region", { name: "My usage" })).toBeVisible();
    await page.getByRole("tab", { name: "Team", exact: true }).click();
    for (const name of [
      "Team spend & budgets",
      "Members",
      "Keys",
      "Model access",
    ]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    await expect(
      page.getByRole("region", { name: "Team spend & budgets" }),
    ).toContainText("LiteLLM-reported");
    await page.getByRole("tab", { name: "Audit" }).click();
    await expect(
      page.getByRole("region", { name: "LiteLLM audit" }),
    ).toContainText("AEDT");
  });

  test("My usage shows the LiteLLM-reported spend, not a load error, when the route needs a range (B4)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page, { ...ME, teams: [] });
    await openPage(page);

    const usage = page.getByRole("region", { name: "My usage" });
    await expect(usage).toContainText("$12.50");
    await expect(usage).not.toContainText("Couldn't load");
  });

  test("shows a Viewer My usage but not LiteLLM audit, and never requests it", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    const hits = await mockApi(page, { ...ME, teams: [] });
    await openPage(page);

    await expect(page.getByRole("region", { name: "My usage" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "LiteLLM audit" }),
    ).toHaveCount(0);
    expect(hits).not.toContain("/api/litellm/audit");
  });

  test("has no serious or critical axe violations", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await openPage(page);
    await page.getByRole("tab", { name: "Audit" }).click();
    await expect(
      page.getByRole("region", { name: "LiteLLM audit" }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => v.id),
    ).toEqual([]);
  });
});

// Views by role (L3b): role x tab in the real shell; behaviour detail lives in
// the component tests (Rule 60.24a).
test.describe("LiteLLM page tabs", () => {
  const names = async (page: Page) =>
    (await page.getByRole("tab").allTextContents()).map((t) => t.trim());

  test("an Admin sees all five tabs and can search users on the Users tab", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await openPage(page);
    expect(await names(page)).toEqual([
      "My usage",
      "Team",
      "Organisation",
      "Users",
      "Audit",
    ]);

    await page.getByRole("tab", { name: "Organisation" }).click();
    await expect(page).toHaveURL(/tab=organisation/);
    await expect(
      page.getByRole("region", { name: "Organisation" }),
    ).toContainText("Payments");

    await page.getByRole("tab", { name: "Users" }).click();
    await page.getByRole("searchbox", { name: /search users/i }).fill("ada");
    await page.getByRole("button", { name: "ada@example.test" }).click();
    await expect(
      page.getByRole("region", { name: /user usage/i }),
    ).toContainText("$77.10");
  });

  test("an org-admin (stand-in for a Lead) sees Team and Users but not Audit", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    const hits = await mockApi(page);
    await openPage(page);
    const tabs = await names(page);
    expect(tabs).toContain("Team");
    expect(tabs).toContain("Users");
    expect(tabs).toContain("Organisation");
    expect(tabs).not.toContain("Audit");
    expect(hits).not.toContain("/api/litellm/audit");

    // Views by role: an org-admin opens the Organisation tab (L3b review).
    await page.getByRole("tab", { name: "Organisation" }).click();
    await expect(
      page.getByRole("region", { name: "Organisation" }),
    ).toContainText("Payments");
  });

  test("a Viewer sees only My usage, and a direct ?tab=audit link falls back to it", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page, { ...ME, teams: [] });
    await page.goto("/dashboard/litellm?tab=audit");
    await waitForHydration(page);
    expect(await names(page)).toEqual(["My usage"]);
    await expect(page.getByRole("region", { name: "My usage" })).toBeVisible();
  });

  test("the Users tab has no serious or critical axe violations", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await page.goto("/dashboard/litellm?tab=users");
    await waitForHydration(page);
    await expect(
      page.getByRole("searchbox", { name: /search users/i }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => v.id),
    ).toEqual([]);
  });
});
