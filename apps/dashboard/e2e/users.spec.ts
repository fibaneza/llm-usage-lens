import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";
import { stubUsageSourceReads } from "./support/usage-source-stubs";

// Phase 4.8 Users (implementation-phases -- Phase 4.8 tasks: users table
// with User / Team / Department / Cost / Tokens / Invocations / % of
// Total, team link, EmptyState; Data Model -- `UsersResponseSchema`, one
// row per team and user; Design System -- Responsive Tables; Rule 40.6;
// Rule 60.24). /api/users is fulfilled from fixtures.
const USERS_URL = /\/api\/users(\?|$)/;
const SYNC_STATUS_URL = /\/api\/sync-status(\?|$)/;

const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PAGE_URL = `/dashboard/users?dateFrom=${RANGE.dateFrom}&dateTo=${RANGE.dateTo}`;

function user(
  userId: string,
  teamId: string,
  teamName: string,
  departmentName: string,
  cost: number,
) {
  return {
    userId,
    teamId,
    teamName,
    departmentId: `dept-${departmentName.toLowerCase()}`,
    departmentName,
    cost,
    costEstimated: true,
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    invocations: 1_200,
  };
}

const USERS = [
  user("alice@example.com", "team-pay", "Payments", "Engineering", 60),
  user("bob@example.com", "team-ledger", "Ledger", "Finance", 30),
  user("alice@example.com", "team-ledger", "Ledger", "Finance", 10),
];

async function mockApi(page: Page, users: unknown[] = USERS) {
  await page.route(SYNC_STATUS_URL, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(USERS_URL, (route) =>
    route.fulfill({ json: { data: { users } } }),
  );
}

async function openUsers(page: Page) {
  await page.goto(PAGE_URL);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("alice@example.com").first()).toBeVisible();
}

test.describe("users page", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
    await stubUsageSourceReads(context);
  });

  test("renders a row per team and user with the seven columns and no console errors", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const consoleErrors = collectConsoleErrors(page);
    await mockApi(page);
    await openUsers(page);

    for (const name of [
      /^User/,
      /^Team/,
      /^Department/,
      /^Cost/,
      /^Tokens/,
      /^Invocations/,
      /^% of Total/,
    ]) {
      await expect(page.getByRole("columnheader", { name })).toBeVisible();
    }
    await expect(
      page.getByRole("row").filter({ hasText: "Payments" }),
    ).toContainText("$60.00");
    await expect(
      page.getByRole("note").filter({ hasText: /model usage only/i }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("a team links to its detail route with the date range carried", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    await openUsers(page);

    const link = page.getByRole("link", { name: "Ledger" }).first();
    const href = await link.getAttribute("href");
    expect(href).toContain("/dashboard/teams/team-ledger");
    expect(href).toContain(`dateFrom=${RANGE.dateFrom}`);
    expect(href).toContain(`dateTo=${RANGE.dateTo}`);
    await link.click();
    await expect(page).toHaveURL(/\/dashboard\/teams\/team-ledger\?/);
    await expect(page).toHaveURL(new RegExp(`dateFrom=${RANGE.dateFrom}`));
    await expect(page).toHaveURL(new RegExp(`dateTo=${RANGE.dateTo}`));
  });

  test("the team link is keyboard reachable and Enter navigates with the range", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    await openUsers(page);

    const link = page.getByRole("link", { name: "Payments" }).first();
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press("Tab");
      if (await link.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/dashboard\/teams\/team-pay\?/);
    await expect(page).toHaveURL(new RegExp(`dateFrom=${RANGE.dateFrom}`));
    await expect(page).toHaveURL(new RegExp(`dateTo=${RANGE.dateTo}`));
  });

  test("shows the empty state, and no table, when there are no users", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page, []);
    await page.goto(PAGE_URL);
    await waitForHydration(page);
    await expect(page.getByText(/no users/i)).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("shows the full table from md and a card list below md", async ({
    page,
  }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 768, height: 900 });
    await openUsers(page);
    await expect(page.getByRole("table")).toBeVisible();

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.getByText("alice@example.com").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Ledger" }).first(),
    ).toBeVisible();
  });

  for (const width of [375, 768, 1024, 1440]) {
    test(`has no horizontal scroll and no serious axe violations at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApi(page);
      await openUsers(page);

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
