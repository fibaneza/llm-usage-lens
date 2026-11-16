import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Phase 4.6 Team Detail (implementation-phases -- Phase 4.6 Verify: "services
// and users tables populated from seed data, model chart renders"; Design
// System -- Team Detail Page, Responsive Tables; Rule 40.6 breakpoints; Rule
// 60.30 / UX Standards for axe). /api/teams/<id> is fulfilled from fixtures
// (Rule 60.24).
const DETAIL_URL = /\/api\/teams\/team-a(\?|$)/;
const SYNC_STATUS_URL = /\/api\/sync-status(\?|$)/;
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PAGE_URL = `/dashboard/teams/team-a?dateFrom=${RANGE.dateFrom}&dateTo=${RANGE.dateTo}`;

function attribution(cost: number) {
  return {
    cost,
    costEstimated: true,
    inputTokens: cost * 1_000,
    outputTokens: cost * 500,
    invocations: cost,
  };
}

const DETAIL = {
  teamId: "team-a",
  teamName: "Platform",
  departmentId: "dept-eng",
  departmentName: "Engineering",
  cost: 600,
  modelCost: 550,
  nonModelCost: 50,
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  invocations: 1_200,
  serviceCount: 3,
  userCount: 2,
  nonModelByCategory: [],
  accounts: [
    {
      accountId: "123456789012",
      cost: 600,
      modelCost: 550,
      nonModelCost: 50,
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      invocations: 1_200,
    },
  ],
  dailyTrend: [],
  byModel: [
    {
      model: "claude-opus",
      cost: 400,
      inputTokens: 600_000,
      outputTokens: 300_000,
      invocations: 700,
    },
    {
      model: "claude-haiku",
      cost: 150,
      inputTokens: 400_000,
      outputTokens: 200_000,
      invocations: 500,
    },
  ],
  services: [
    { serviceName: "chat-api", ...attribution(300) },
    { serviceName: "_untagged", ...attribution(50) },
    { serviceName: "search", ...attribution(200) },
  ],
  users: [
    { userId: "alice.smith", ...attribution(120) },
    { userId: "bob", ...attribution(80) },
  ],
};

async function mockApi(page: Page) {
  await page.route(SYNC_STATUS_URL, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(DETAIL_URL, (route) =>
    route.fulfill({ json: { data: DETAIL } }),
  );
}

async function openDetail(page: Page) {
  await page.goto(PAGE_URL);
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: "Platform" }).first(),
  ).toBeVisible();
}

test.describe("team detail page", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  test("renders the header and the three data sections without errors", async ({
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
        .getByRole("link", { name: "Teams" }),
    ).toHaveAttribute(
      "href",
      new RegExp(
        `^/dashboard/teams\\?.*dateFrom=${RANGE.dateFrom}.*dateTo=${RANGE.dateTo}`,
      ),
    );
    await expect(page.getByText("Engineering").first()).toBeVisible();
    await expect(page.getByText("123-456-789-012")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /copy.*account id/i }),
    ).toBeVisible();
    await expect(page.getByText(/bedrock service charges only/i)).toBeVisible();
    await expect(page.getByRole("group", { name: "Total cost" })).toContainText(
      "$600.00",
    );

    const services = page.getByRole("region", { name: "Services breakdown" });
    await expect(services.getByRole("table")).toContainText("chat-api");
    await expect(services.getByRole("table")).toContainText("Untagged");
    const users = page.getByRole("region", { name: "Users breakdown" });
    await expect(users.getByRole("table")).toContainText("alice.smith");
    await expect(users.getByText("Estimated").first()).toBeAttached();
    await expect(
      page
        .getByRole("region", { name: "Model usage" })
        .getByRole("img", { name: /model usage.*bar chart/i }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("copies the raw account id and announces Copied", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mockApi(page);
    await openDetail(page);

    await page.getByRole("button", { name: /copy.*account id/i }).click();

    await expect(
      page.getByRole("status").filter({ hasText: "Copied" }),
    ).toBeAttached();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "123456789012",
    );
  });

  test("sorts the services table by cost", async ({ page }) => {
    await mockApi(page);
    await openDetail(page);

    const table = page
      .getByRole("region", { name: "Services breakdown" })
      .getByRole("table");
    const firstRow = table.getByRole("row").nth(1);
    await expect(firstRow).toContainText("chat-api");

    await table
      .getByRole("columnheader", { name: /^Cost/ })
      .getByRole("button")
      .click();

    await expect(firstRow).toContainText("Untagged");
  });

  // Rule 40.6 + Design System "Responsive Tables": cards below 768px.
  test("renders both breakdowns as cards at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockApi(page);
    await openDetail(page);

    for (const [name, text] of [
      ["Services breakdown", "chat-api"],
      ["Users breakdown", "alice.smith"],
    ] as const) {
      const region = page.getByRole("region", { name });
      await expect(region.getByRole("listitem").first()).toBeVisible();
      await expect(region).toContainText(text);
      await expect(region.getByRole("table")).toHaveCount(0);
    }
  });

  for (const width of [768, 1024, 1440]) {
    test(`renders both breakdowns as tables at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApi(page);
      await openDetail(page);

      for (const name of ["Services breakdown", "Users breakdown"]) {
        await expect(
          page.getByRole("region", { name }).getByRole("table"),
        ).toBeVisible();
      }
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
          error: { code: "NOT_FOUND", message: "Team team-a not found" },
        },
      }),
    );
    await page.goto(PAGE_URL);
    await waitForHydration(page);

    await expect(page.getByText("Team not found")).toBeVisible();
    await expect(page.getByRole("button", { name: /retry/i })).toHaveCount(0);
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
        page.getByRole("region", { name: "Users breakdown" }),
      ).toContainText("alice.smith");

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
        page.getByRole("region", { name: "Users breakdown" }),
      ).toContainText("alice.smith");

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
