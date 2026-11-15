import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: docs/specs/2026-11-10-litellm.md -- Page and Settings, Roles and
// rights, Cost visualisation and provenance (LT8), LD20; implementation-phases
// L3 ("e2e probe, fake"). The LiteLLM API is fulfilled from fixtures
// (Rule 60.24). Behaviour detail lives in the component tests (Rule 60.24a);
// this covers the real shell, role gating and axe.
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

    for (const name of [
      "My usage",
      "Team spend & budgets",
      "Members",
      "Keys",
      "Model access",
      "LiteLLM audit",
    ]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    await expect(
      page.getByRole("region", { name: "Team spend & budgets" }),
    ).toContainText("LiteLLM-reported");
    await expect(
      page.getByRole("region", { name: "LiteLLM audit" }),
    ).toContainText("AEDT");
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
