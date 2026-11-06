import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Phase 4.7 Services (implementation-phases -- Phase 4.7 tasks: services table
// with Service Name / Team / Department / Cost / Tokens / Invocations / % of
// Total, team link, EmptyState; Data Model -- `ServicesResponseSchema`, one
// row per team and service; Design System -- Responsive Tables; Rule 40.6;
// Rule 60.24). /api/services is fulfilled from fixtures.
const SERVICES_URL = /\/api\/services(\?|$)/;
const SYNC_STATUS_URL = /\/api\/sync-status(\?|$)/;

const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PAGE_URL = `/dashboard/services?dateFrom=${RANGE.dateFrom}&dateTo=${RANGE.dateTo}`;

function service(
  serviceName: string,
  teamId: string,
  teamName: string,
  departmentName: string,
  cost: number,
) {
  return {
    serviceName,
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

const SERVICES = [
  service("payments-api", "team-pay", "Payments", "Engineering", 60),
  service("ledger-svc", "team-ledger", "Ledger", "Finance", 30),
  service("_untagged", "team-pay", "Payments", "Engineering", 10),
];

const ALL_UNTAGGED = [
  service("_untagged", "team-pay", "Payments", "Engineering", 5),
  service("_untagged", "team-ledger", "Ledger", "Finance", 3),
];

async function mockApi(page: Page, services: unknown[] = SERVICES) {
  await page.route(SYNC_STATUS_URL, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(SERVICES_URL, (route) =>
    route.fulfill({ json: { data: { services } } }),
  );
}

async function openServices(page: Page) {
  await page.goto(PAGE_URL);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("payments-api").first()).toBeVisible();
}

test.describe("services page", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  test("renders a row per team and service with the seven columns and no console errors", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const consoleErrors = collectConsoleErrors(page);
    await mockApi(page);
    await openServices(page);

    for (const name of [
      /^Service Name/,
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
      page.getByRole("row").filter({ hasText: "payments-api" }),
    ).toContainText("$60.00");
    await expect(page.getByText("Untagged").first()).toBeVisible();
    await expect(page.getByRole("note")).toContainText(/model usage only/i);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("a team links to its detail route with the date range carried", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    await openServices(page);

    const link = page.getByRole("link", { name: "Ledger" }).first();
    const href = await link.getAttribute("href");
    expect(href).toContain("/dashboard/teams/team-ledger");
    expect(href).toContain(`dateFrom=${RANGE.dateFrom}`);
    expect(href).toContain(`dateTo=${RANGE.dateTo}`);
    await link.click();
    await expect(page).toHaveURL(/\/dashboard\/teams\/team-ledger\?/);
  });

  test("shows the empty state, and no table, when there are no services", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page, []);
    await page.goto(PAGE_URL);
    await waitForHydration(page);
    await expect(page.getByText(/no services/i)).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("keeps the table and shows a notice when all usage is untagged", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page, ALL_UNTAGGED);
    await page.goto(PAGE_URL);
    await waitForHydration(page);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText("Untagged").first()).toBeVisible();
    await expect(
      page.getByText(/no usage carries a service tag/i),
    ).toBeVisible();
    await expect(page.getByText(/no services/i)).toHaveCount(0);
  });

  test("shows the full table from md and a card list below md", async ({
    page,
  }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 768, height: 900 });
    await openServices(page);
    await expect(page.getByRole("table")).toBeVisible();

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.getByText("payments-api").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Ledger" })).toBeVisible();
  });

  for (const width of [375, 768, 1024, 1440]) {
    test(`has no horizontal scroll and no serious axe violations at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApi(page);
      await openServices(page);

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
