import { readFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

import type { ModelKey } from "@llm-usage-lens/shared";

import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Phase 4.3 Departments (implementation-phases -- Phase 4.3 Verify: "links
// navigate to detail pages"; Design System -- Navigation (Sidebar), Departments
// row: a table of cost, change, tokens, teams and top model linking to detail,
// amended 2026-11-16; Responsive Tables: a card list below md; Rule 20.12). The
// browser-side requests to /api/departments are fulfilled from fixtures so the
// assertions are deterministic and independent of DynamoDB Local (Rule 60.24).
const DEPARTMENTS_URL = /\/api\/departments(\?|$)/;
const SYNC_STATUS_URL = /\/api\/sync-status(\?|$)/;

// Hard-coded rather than derived from lib/date-range so the spec does not
// trust the code under test: the 10 days before 2026-01-11 are 01-01..01-10.
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PREVIOUS = { dateFrom: "2026-01-01", dateTo: "2026-01-10" };
const PAGE_URL = `/dashboard/departments?dateFrom=${RANGE.dateFrom}&dateTo=${RANGE.dateTo}`;

type Department = {
  departmentId: string;
  departmentName: string;
  cost: number;
  modelCost: number;
  nonModelCost: number;
  inputTokens: number;
  outputTokens: number;
  invocations: number;
  teamCount: number;
  topModel: ModelKey | null;
};

function department(
  departmentId: string,
  departmentName: string,
  cost: number,
  inputTokens: number,
  outputTokens: number,
  teamCount: number,
  topModel: ModelKey | null,
): Department {
  return {
    departmentId,
    departmentName,
    cost,
    modelCost: topModel === null ? 0 : cost,
    nonModelCost: topModel === null ? cost : 0,
    inputTokens,
    outputTokens,
    invocations: topModel === null ? 0 : 1_000,
    teamCount,
    topModel,
  };
}

// Six departments. The first has a long name and
// large figures to try the narrowest widths; Legal has no model usage.
const CURRENT: Department[] = [
  department(
    "dept-ops",
    "Corporate Strategy and Partnerships Office",
    12_345.67,
    98_765_432,
    87_654_321,
    12,
    "other",
  ),
  department(
    "dept-eng",
    "Engineering",
    600,
    1_000_000,
    500_000,
    3,
    "claude-opus",
  ),
  department(
    "dept-data",
    "Data Science",
    300,
    400_000,
    200_000,
    1,
    "claude-sonnet",
  ),
  department("dept-mkt", "Marketing", 60, 50_000, 25_000, 2, "claude-haiku"),
  department("dept-legal", "Legal", 40, 0, 0, 1, null),
  department("dept-support", "Support", 10, 8_000, 4_000, 4, "claude-haiku"),
];

// Engineering +20.0%, Data Science -50.0%; Marketing, Support and the Ops
// department have no previous row, and Legal's previous cost is 0.
const PREVIOUS_ROWS: Department[] = [
  department(
    "dept-eng",
    "Engineering",
    500,
    900_000,
    400_000,
    3,
    "claude-opus",
  ),
  department(
    "dept-data",
    "Data Science",
    600,
    800_000,
    400_000,
    1,
    "claude-sonnet",
  ),
  department("dept-legal", "Legal", 0, 0, 0, 1, null),
];

type DepartmentsRequest = { dateFrom: string | null; dateTo: string | null };

async function mockApi(
  page: Page,
  options: { current?: Department[]; previous?: Department[] } = {},
): Promise<DepartmentsRequest[]> {
  const { current = CURRENT, previous = PREVIOUS_ROWS } = options;
  const requests: DepartmentsRequest[] = [];
  await page.route(SYNC_STATUS_URL, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(DEPARTMENTS_URL, async (route) => {
    const url = new URL(route.request().url());
    requests.push({
      dateFrom: url.searchParams.get("dateFrom"),
      dateTo: url.searchParams.get("dateTo"),
    });
    const isPrevious = url.searchParams.get("dateFrom") === PREVIOUS.dateFrom;
    await route.fulfill({
      json: { data: { departments: isPrevious ? previous : current } },
    });
  });
  return requests;
}

// Page content is everything in <main> except the top bar (<header>, which
// holds its own controls and skeletons). Scoping to it also excludes Next's
// route announcer, a role="alert" node outside <main> on every page.
function content(page: Page): Locator {
  return page.locator("main > :not(header)");
}

// Each department is a link to its detail page (the name cell of a table row,
// the title of a card below md).
function cards(page: Page): Locator {
  return content(page).getByRole("link");
}

function cardNamed(page: Page, name: string): Locator {
  return cards(page).filter({ hasText: name });
}

// The table row (desktop) or card-list item (below md) holding a department.
function rowNamed(page: Page, name: string): Locator {
  return content(page)
    .getByRole("row")
    .or(content(page).getByRole("listitem"))
    .filter({ hasText: name });
}

async function openDepartments(page: Page, count = CURRENT.length) {
  await page.goto(PAGE_URL);
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Cost by department" }),
  ).toBeVisible();
  await expect(cards(page)).toHaveCount(count);
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${label}: page scrolls horizontally`,
  ).toBeLessThanOrEqual(overflow.clientWidth);

  const spill = await cards(page).evaluateAll((links) =>
    links.flatMap((link) => {
      const box = link.getBoundingClientRect();
      const problems: string[] = [];
      if (box.right > document.documentElement.clientWidth + 1) {
        problems.push(`link right edge ${box.right} is past the viewport`);
      }
      return problems.map((p) => `${link.textContent?.slice(0, 30)}: ${p}`);
    }),
  );
  expect(spill, `${label}: department links spill`).toEqual([]);
}

test.describe("departments page", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  test("renders one table row per department with its figures, and requests the current and previous range", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const consoleErrors = collectConsoleErrors(page);
    const requests = await mockApi(page);

    await openDepartments(page);

    const engineering = rowNamed(page, "Engineering");
    await expect(engineering).toContainText("$600.00");
    await expect(engineering).toContainText(/1,500,000|1\.5M/);
    await expect(
      engineering.getByRole("cell", { name: "3", exact: true }),
    ).toBeVisible();
    await expect(engineering).toContainText("Claude Opus");

    const data = rowNamed(page, "Data Science");
    await expect(data).toContainText("$300.00");
    await expect(data).toContainText(/600,000|600K/);
    await expect(
      data.getByRole("cell", { name: "1", exact: true }),
    ).toBeVisible();
    await expect(data).toContainText("Claude Sonnet");

    await expect(rowNamed(page, "Marketing")).toContainText("Claude Haiku");
    await expect(
      rowNamed(page, "Corporate Strategy and Partnerships Office"),
    ).toContainText("Other models");
    await expect(
      rowNamed(page, "Corporate Strategy and Partnerships Office"),
    ).toContainText(/\$12,345\.67|\$12\.3K/);

    expect(requests).toContainEqual(RANGE);
    expect(requests).toContainEqual(PREVIOUS);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("a department link opens that department's detail route with the date range carried", async ({
    page,
  }) => {
    await mockApi(page);
    // Compile the destination before the click so the dev server's first-hit
    // compile does not race the assertions (Rule 60.24 -- no sleeps).
    await page.request.get("/dashboard/departments/dept-eng");
    await openDepartments(page);

    await cardNamed(page, "Engineering").click();

    await expect(page).toHaveURL(/\/dashboard\/departments\/dept-eng\?/);
    const url = new URL(page.url());
    expect(url.pathname).toBe("/dashboard/departments/dept-eng");
    expect(url.searchParams.get("dateFrom")).toBe(RANGE.dateFrom);
    expect(url.searchParams.get("dateTo")).toBe(RANGE.dateTo);
  });

  // Review round 1 W8 (Design System -- Departments row; Phase 4.3 toolbar):
  // search narrows the rows and Export CSV downloads with the header row.
  test("searches by department name and exports the CSV with its header row", async ({
    page,
  }) => {
    await mockApi(page);
    await openDepartments(page);

    await content(page)
      .getByRole("searchbox", { name: /search by department/i })
      .fill("Engin");
    await expect(rowNamed(page, "Engineering")).toBeVisible();
    await expect(rowNamed(page, "Marketing")).toHaveCount(0);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      content(page).getByRole("button", { name: "Export CSV" }).click(),
    ]);
    const path = await download.path();
    expect(path).not.toBeNull();
    const lines = (await readFile(path, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.length > 0);

    expect(lines[0]).toMatch(/^Department,Cost,/);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Engineering");
  });

  test("a department link is reachable and activated from the keyboard", async ({
    page,
  }) => {
    await mockApi(page);
    await page.request.get("/dashboard/departments/dept-data");
    await openDepartments(page);

    const data = cardNamed(page, "Data Science");
    await page.keyboard.press("Tab");
    await data.focus();
    await expect(data).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/dashboard\/departments\/dept-data\?/);
  });

  test("a focused department link shows a visible focus indicator", async ({
    page,
  }) => {
    await mockApi(page);
    await openDepartments(page);

    const card = cardNamed(page, "Engineering");
    // Everything painted on the link or inside it that could carry a ring.
    const paint = () =>
      card.evaluate((link) =>
        [link, ...link.querySelectorAll("*")]
          .map((el) => {
            const style = getComputedStyle(el);
            return [
              style.boxShadow,
              style.outlineStyle,
              style.outlineWidth,
              style.outlineColor,
              style.borderColor,
            ].join("/");
          })
          .join("|"),
      );
    const before = await paint();

    await page.keyboard.press("Tab");
    await card.focus();
    await expect(card).toBeFocused();

    await expect.poll(paint).not.toBe(before);
  });
});

// Design System -- Responsive Tables: the full table from md (768px) up, a card
// list below; the page never scrolls horizontally, with the sidebar expanded or
// collapsed (Rule 40.6).
const LAYOUTS = [
  { width: 375, height: 812, table: false },
  { width: 768, height: 1024, table: true },
  { width: 1024, height: 768, table: true },
  { width: 1440, height: 900, table: true },
] as const;

test.describe("departments page - responsive layout", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  for (const { width, height, table } of LAYOUTS) {
    test(`shows ${table ? "the table" : "the card list"} without horizontal scroll at ${width}px (sidebar expanded)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await mockApi(page);

      await openDepartments(page);

      await expect(
        content(page).getByRole("table", { name: "Departments" }),
      ).toHaveCount(table ? 1 : 0);
      await expect(
        content(page).getByRole("list", { name: "Departments" }),
      ).toHaveCount(table ? 0 : 1);
      await expectNoHorizontalOverflow(page, `${width}px expanded`);
    });
  }

  for (const { width, height } of LAYOUTS.filter(
    (layout) => layout.width >= 768,
  )) {
    test(`keeps the table and no horizontal scroll at ${width}px with the sidebar collapsed`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await mockApi(page);
      await openDepartments(page);

      await page.getByRole("button", { name: "Collapse", exact: true }).click();
      await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute(
        "data-state",
        "collapsed",
      );

      await expect(cards(page)).toHaveCount(CURRENT.length);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(0);
      await expectNoHorizontalOverflow(page, `${width}px collapsed`);
    });
  }
});

// Design System -- UX Standards (contrast 4.5:1), Rule 60.30. Measured on the
// loaded page: delta badges and model names only render with data.
test.describe("departments page - accessibility (axe)", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
  ]) {
    test(`has no serious or critical violations with the departments loaded at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await mockApi(page);
      await openDepartments(page);
      await expect(
        rowNamed(page, "Engineering").getByRole("img", {
          name: "Up 20.0% vs previous period",
        }),
      ).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const blocking = results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );

      expect(
        blocking.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map((node) => node.target.join(" ")),
        })),
      ).toEqual([]);
    });
  }

  test("has no serious or critical violations in the empty state", async ({
    page,
  }) => {
    await mockApi(page, { current: [], previous: [] });
    await page.goto(PAGE_URL);
    await waitForHydration(page);
    await expect(
      content(page)
        .getByText(/\bno (departments?|usage|data|cost)/i)
        .first(),
    ).toBeVisible();

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
});
