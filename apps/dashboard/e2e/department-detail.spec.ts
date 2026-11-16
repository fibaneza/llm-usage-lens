import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Phase 4.4 Department Detail (implementation-phases -- Phase 4.4 Verify:
// "page loads for each department in seed data, charts and tables render
// correctly"; Rule 40.6 breakpoints; Rule 60.30 / Design System UX Standards
// for axe). /api/departments/<id> is fulfilled from fixtures (Rule 60.24).
const DETAIL_URL = /\/api\/departments\/dept-eng(\?|$)/;
const SYNC_STATUS_URL = /\/api\/sync-status(\?|$)/;
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PREVIOUS = { dateFrom: "2026-01-01", dateTo: "2026-01-10" };
const PAGE_URL = `/dashboard/departments/dept-eng?dateFrom=${RANGE.dateFrom}&dateTo=${RANGE.dateTo}`;

function team(teamId: string, teamName: string, cost: number) {
  return {
    teamId,
    teamName,
    departmentId: "dept-eng",
    departmentName: "Engineering",
    cost,
    modelCost: cost,
    nonModelCost: 0,
    inputTokens: cost * 1_000,
    outputTokens: cost * 500,
    invocations: cost,
    serviceCount: 2,
    userCount: 3,
  };
}

function detail(cost: number, withBreakdown: boolean) {
  return {
    departmentId: "dept-eng",
    departmentName: "Engineering",
    cost,
    modelCost: cost,
    nonModelCost: 0,
    inputTokens: cost * 1_000,
    outputTokens: cost * 500,
    invocations: cost * 2,
    teamCount: 2,
    topModel: "claude-opus",
    nonModelByCategory: [],
    dailyTrend: [],
    teams: withBreakdown
      ? [team("team-a", "Platform", 200), team("team-b", "Research", 400)]
      : [],
    teamTrend: withBreakdown
      ? [
          {
            date: "2026-01-19",
            teams: [
              { teamId: "team-a", cost: 90 },
              { teamId: "team-b", cost: 210 },
            ],
          },
          {
            date: "2026-01-20",
            teams: [
              { teamId: "team-a", cost: 110 },
              { teamId: "team-b", cost: 190 },
            ],
          },
        ]
      : [],
    topUsers: withBreakdown
      ? [
          {
            userId: "alice",
            cost: 120,
            costEstimated: true,
            inputTokens: 100_000,
            outputTokens: 50_000,
            invocations: 100,
          },
          {
            userId: "bob",
            cost: 80,
            costEstimated: true,
            inputTokens: 60_000,
            outputTokens: 20_000,
            invocations: 60,
          },
        ]
      : [],
  };
}

async function mockApi(page: Page) {
  await page.route(SYNC_STATUS_URL, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(DETAIL_URL, async (route) => {
    const url = new URL(route.request().url());
    const isPrevious = url.searchParams.get("dateFrom") === PREVIOUS.dateFrom;
    await route.fulfill({
      json: { data: isPrevious ? detail(500, false) : detail(600, true) },
    });
  });
}

async function openDetail(page: Page) {
  await page.goto(PAGE_URL);
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: "Engineering" }).first(),
  ).toBeVisible();
}

test.describe("department detail page", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  test("renders the header and the four sections without errors", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (e) => pageErrors.push(e));
    const consoleErrors = collectConsoleErrors(page);
    await mockApi(page);

    await openDetail(page);

    // Page frame (Design System -- Layout, 2026-11-16): breadcrumb back to the
    // list with the date range carried.
    await expect(
      page
        .getByRole("navigation", { name: "Breadcrumb" })
        .getByRole("link", { name: "Departments" }),
    ).toHaveAttribute(
      "href",
      new RegExp(
        `^/dashboard/departments\\?.*dateFrom=${RANGE.dateFrom}.*dateTo=${RANGE.dateTo}`,
      ),
    );
    await expect(page.getByRole("group", { name: "Total cost" })).toContainText(
      "$600.00",
    );
    await expect(
      page
        .getByRole("group", { name: "Total cost" })
        .getByRole("img", { name: "Up 20.0% vs previous period" }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: /period comparison/i }),
    ).toContainText("vs previous 10 days");
    const teams = page.getByRole("region", { name: "Teams breakdown" });
    await expect(teams.getByRole("table")).toContainText("Platform");
    await expect(teams.getByRole("table")).toContainText("Research");
    await expect(
      page
        .getByRole("region", { name: "Cost by team over time" })
        .getByRole("img", { name: "Cost trend by team, stacked area chart" }),
    ).toBeVisible();
    const users = page.getByRole("region", { name: "Top users" });
    await expect(users).toContainText("alice");
    await expect(users.getByText("Estimated").first()).toBeAttached();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("sorts the teams table by cost", async ({ page }) => {
    await mockApi(page);
    await openDetail(page);

    const table = page
      .getByRole("region", { name: "Teams breakdown" })
      .getByRole("table");
    const firstRow = table.getByRole("row").nth(1);
    await expect(firstRow).toContainText("Research");

    await table
      .getByRole("columnheader", { name: /^Cost/ })
      .getByRole("button")
      .click();

    await expect(firstRow).toContainText("Platform");
  });

  // Rule 40.6 + Design System "Responsive Tables": cards below 768px.
  test("renders the teams breakdown as cards at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockApi(page);
    await openDetail(page);

    const teams = page.getByRole("region", { name: "Teams breakdown" });
    await expect(teams.getByRole("listitem").first()).toBeVisible();
    await expect(teams).toContainText("Platform");
    await expect(teams).toContainText("Research");
    await expect(teams.getByRole("table")).toHaveCount(0);
  });

  for (const width of [768, 1024, 1440]) {
    test(`renders the teams breakdown as a table at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApi(page);
      await openDetail(page);

      await expect(
        page
          .getByRole("region", { name: "Teams breakdown" })
          .getByRole("table"),
      ).toBeVisible();
    });
  }

  test("shows the not-found state, without Retry, on a 404", async ({
    page,
  }) => {
    await page.route(SYNC_STATUS_URL, (route) =>
      route.fulfill({ json: { data: { state: "never-synced" } } }),
    );
    await page.route(DETAIL_URL, (route) =>
      route.fulfill({
        status: 404,
        json: {
          error: {
            code: "NOT_FOUND",
            message: "Department dept-eng not found",
          },
        },
      }),
    );
    await page.goto(PAGE_URL);
    await waitForHydration(page);

    await expect(page.getByText("Department not found")).toBeVisible();
    await expect(page.getByRole("button", { name: /retry/i })).toHaveCount(0);
  });

  test("shows an alert with Retry on a 500", async ({ page }) => {
    await page.route(SYNC_STATUS_URL, (route) =>
      route.fulfill({ json: { data: { state: "never-synced" } } }),
    );
    await page.route(DETAIL_URL, (route) =>
      route.fulfill({
        status: 500,
        json: { error: { code: "INTERNAL", message: "boom" } },
      }),
    );
    await page.goto(PAGE_URL);
    await waitForHydration(page);

    const alert = page.getByRole("alert").filter({ hasText: /couldn.t load/i });
    await expect(alert.first()).toBeVisible({ timeout: 15_000 });
    await expect(
      alert.first().getByRole("button", { name: /retry/i }),
    ).toBeVisible();
  });

  for (const { width, height } of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockApi(page);
      await openDetail(page);
      await expect(
        page.getByRole("region", { name: "Top users" }),
      ).toContainText("alice");

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        `${width}px scrolls horizontally`,
      ).toBeLessThanOrEqual(overflow.clientWidth);
    });

    test(`has no serious or critical axe violations at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await mockApi(page);
      await openDetail(page);
      await expect(
        page.getByRole("region", { name: "Top users" }),
      ).toContainText("alice");

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
    });
  }
});
