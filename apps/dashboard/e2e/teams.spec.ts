import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Phase 4.5 Teams (implementation-phases -- Phase 4.5 tasks and Verify: "all
// teams from seed data appear, filter narrows results"; Design System --
// Responsive Tables: full table from md, card list below; Rule 40.6
// breakpoints 375 / 768 / 1024 / 1440; Rule 60.24). /api/teams and
// /api/departments are fulfilled from fixtures.
const TEAMS_URL = /\/api\/teams(\?|$)/;
const DEPARTMENTS_URL = /\/api\/departments(\?|$)/;
const SYNC_STATUS_URL = /\/api\/sync-status(\?|$)/;

const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PAGE_URL = `/dashboard/teams?dateFrom=${RANGE.dateFrom}&dateTo=${RANGE.dateTo}`;

function team(
  teamId: string,
  teamName: string,
  departmentId: string,
  departmentName: string,
  cost: number,
  serviceCount: number,
  userCount: number,
) {
  return {
    teamId,
    teamName,
    departmentId,
    departmentName,
    cost,
    modelCost: cost,
    nonModelCost: 0,
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    invocations: 1_200,
    serviceCount,
    userCount,
  };
}

const TEAMS = [
  team("team-pay", "Payments", "dept-eng", "Engineering", 600, 4, 7),
  team(
    "team-plat",
    "Platform and Infrastructure Reliability Engineering",
    "dept-eng",
    "Engineering",
    300,
    2,
    3,
  ),
  team("team-ledger", "Ledger", "dept-fin", "Finance", 100, 0, 0),
];

const DEPARTMENTS = ["dept-eng:Engineering", "dept-fin:Finance"].map((s) => {
  const [departmentId, departmentName] = s.split(":");
  return {
    departmentId,
    departmentName,
    cost: 100,
    modelCost: 100,
    nonModelCost: 0,
    inputTokens: 0,
    outputTokens: 0,
    invocations: 0,
    teamCount: 1,
    topModel: null,
  };
});

async function mockApi(page: Page, teams = TEAMS): Promise<URL[]> {
  const requests: URL[] = [];
  await page.route(SYNC_STATUS_URL, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(DEPARTMENTS_URL, (route) =>
    route.fulfill({ json: { data: { departments: DEPARTMENTS } } }),
  );
  await page.route(TEAMS_URL, (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const dep = url.searchParams.get("departmentId");
    return route.fulfill({
      json: {
        data: {
          teams: dep ? teams.filter((t) => t.departmentId === dep) : teams,
        },
      },
    });
  });
  return requests;
}

async function openTeams(page: Page) {
  await page.goto(PAGE_URL);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Payments" })).toBeVisible();
}

test.describe("teams page", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  test("renders a row per team with the seven columns and no console errors", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const consoleErrors = collectConsoleErrors(page);
    await mockApi(page);
    await openTeams(page);

    for (const name of [
      /^Team Name/,
      /^Department/,
      /^Cost/,
      /^Tokens/,
      /^Invocations/,
      /^Services/,
      /^Users/,
    ]) {
      await expect(page.getByRole("columnheader", { name })).toBeVisible();
    }
    await expect(
      page.getByRole("row").filter({ hasText: "Payments" }),
    ).toContainText("$600.00");
    await expect(page.getByRole("link", { name: "Ledger" })).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("the department filter narrows the rows and requests departmentId", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const requests = await mockApi(page);
    await openTeams(page);

    await page.getByRole("combobox", { name: "Department" }).click();
    await page.getByRole("option", { name: "Finance" }).click();

    await expect(page.getByRole("link", { name: "Payments" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ledger" })).toBeVisible();
    expect(
      requests.some((u) => u.searchParams.get("departmentId") === "dept-fin"),
    ).toBe(true);
  });

  test("a team name links to its detail route with the date range carried", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    await openTeams(page);

    const href = await page
      .getByRole("link", { name: "Payments" })
      .getAttribute("href");
    expect(href).toContain("/dashboard/teams/team-pay");
    expect(href).toContain(`dateFrom=${RANGE.dateFrom}`);
    expect(href).toContain(`dateTo=${RANGE.dateTo}`);
  });

  test("shows the empty state, and no table, when there are no teams", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page, []);
    await page.goto(PAGE_URL);
    await waitForHydration(page);
    await expect(page.getByText(/no teams/i)).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("shows the full table from md and a card list below md", async ({
    page,
  }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 768, height: 900 });
    await openTeams(page);
    await expect(page.getByRole("table")).toBeVisible();

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.getByRole("link", { name: "Payments" })).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Department" }),
    ).toBeVisible();
  });

  for (const width of [375, 768, 1024, 1440]) {
    test(`has no horizontal scroll and no serious axe violations at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApi(page);
      await openTeams(page);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(blocking.map((v) => ({ id: v.id, help: v.help }))).toEqual([]);
    });
  }
});
