import {
  expect,
  type Locator,
  type Page,
  type Route,
  test,
} from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Phase 5, "UI refresh -- fluid workspace" (implementation-phases; Design
// System -- Layout: Breakpoints, Structure). Everything is asserted on rendered
// geometry and computed style, never class names. The container/gutter checks
// live in responsive.spec.ts. All /api/* reads are fulfilled from fixtures
// (Rule 60.24).
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const QUERY = `dateFrom=${RANGE.dateFrom}&dateTo=${RANGE.dateTo}`;

function attribution(cost: number) {
  return {
    cost,
    costEstimated: true,
    inputTokens: cost * 1_000,
    outputTokens: cost * 500,
    invocations: cost,
  };
}

function rankingRow(id: string, name: string, cost: number) {
  return { id, name, ...attribution(cost) };
}

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

const OVERVIEW = {
  totalCost: 1234.56,
  modelCost: 1000,
  nonModelCost: 234.56,
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  invocations: 2_000,
  costFinalized: true,
  activeAccounts: 7,
  mostUsedModel: "claude-opus",
  byModel: [
    {
      model: "claude-opus",
      cost: 700,
      inputTokens: 600_000,
      outputTokens: 300_000,
      invocations: 1_200,
    },
    {
      model: "claude-sonnet",
      cost: 300,
      inputTokens: 400_000,
      outputTokens: 200_000,
      invocations: 800,
    },
  ],
  nonModelByCategory: [
    { category: "guardrails", cost: 34.56, recurring: false },
  ],
  dailyTrend: [
    {
      date: "2026-01-19",
      cost: 600,
      modelCost: 500,
      nonModelCost: 100,
      byModel: { "claude-opus": 350, "claude-sonnet": 150 },
    },
    {
      date: "2026-01-20",
      cost: 634.56,
      modelCost: 500,
      nonModelCost: 134.56,
      byModel: { "claude-opus": 350, "claude-sonnet": 150 },
    },
  ],
  topDepartments: [
    { departmentId: "dept-eng", departmentName: "Engineering", cost: 800 },
    { departmentId: "dept-data", departmentName: "Data Science", cost: 434.56 },
  ],
};

const TEAM_DETAIL = {
  ...team("team-a", "Platform", 600),
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
  ],
  services: [
    { serviceName: "chat-api", ...attribution(300) },
    { serviceName: "search", ...attribution(200) },
    { serviceName: "_untagged", ...attribution(50) },
  ],
  users: [
    { userId: "alice.smith", ...attribution(120) },
    { userId: "bob", ...attribution(80) },
  ],
};

const DEPARTMENT_DETAIL = {
  departmentId: "dept-eng",
  departmentName: "Engineering",
  cost: 600,
  modelCost: 600,
  nonModelCost: 0,
  inputTokens: 600_000,
  outputTokens: 300_000,
  invocations: 1_200,
  teamCount: 2,
  topModel: "claude-opus",
  nonModelByCategory: [],
  dailyTrend: [],
  teams: [team("team-a", "Platform", 200), team("team-b", "Research", 400)],
  teamTrend: [
    {
      date: "2026-01-20",
      teams: [
        { teamId: "team-a", cost: 110 },
        { teamId: "team-b", cost: 190 },
      ],
    },
  ],
  topUsers: [{ userId: "alice", ...attribution(120) }],
};

function account(accountId: string, accountName: string, active: boolean) {
  return {
    accountId,
    accountName,
    departmentId: "dept-eng",
    departmentName: "Engineering",
    teamId: "team-pay",
    teamName: "Payments",
    region: "ap-southeast-2",
    active,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

function serviceRow(serviceName: string, cost: number) {
  return {
    serviceName,
    teamId: "team-pay",
    teamName: "Payments",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    ...attribution(cost),
  };
}

function userRow(userId: string, cost: number) {
  return {
    userId,
    teamId: "team-pay",
    teamName: "Payments",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    ...attribution(cost),
  };
}

async function mockApi(page: Page, { emptyUsers = false } = {}) {
  const json = (body: unknown) => (route: Route) =>
    route.fulfill({ json: { data: body } });

  await page.route(/\/api\/sync-status(\?|$)/, json({ state: "never-synced" }));
  await page.route(/\/api\/overview(\?|$)/, json(OVERVIEW));
  await page.route(
    /\/api\/ranking(\?|$)/,
    json({
      tab: "departments",
      rows: [
        rankingRow("dept-eng", "Engineering", 600),
        rankingRow("dept-data", "Data Science", 300),
        rankingRow("dept-mkt", "Marketing", 60),
        rankingRow("dept-legal", "Legal", 40),
      ],
    }),
  );
  await page.route(
    /\/api\/departments(\?|$)/,
    json({
      departments: [
        {
          departmentId: "dept-eng",
          departmentName: "Engineering",
          cost: 100,
          modelCost: 100,
          nonModelCost: 0,
          inputTokens: 0,
          outputTokens: 0,
          invocations: 0,
          teamCount: 1,
          topModel: null,
        },
      ],
    }),
  );
  await page.route(
    /\/api\/departments\/dept-eng(\?|$)/,
    json(DEPARTMENT_DETAIL),
  );
  await page.route(
    /\/api\/teams(\?|$)/,
    json({
      teams: [
        team("team-a", "Platform", 600),
        team("team-b", "Research", 300),
        team("team-c", "Ledger", 100),
      ],
    }),
  );
  await page.route(/\/api\/teams\/team-a(\?|$)/, json(TEAM_DETAIL));
  await page.route(
    /\/api\/services(\?|$)/,
    json({
      services: [
        serviceRow("payments-api", 60),
        serviceRow("ledger-svc", 30),
        serviceRow("_untagged", 10),
      ],
    }),
  );
  await page.route(
    /\/api\/users(\?|$)/,
    json({
      users: emptyUsers
        ? []
        : [userRow("alice@example.com", 60), userRow("bob@example.com", 30)],
    }),
  );
  await page.route(
    /\/api\/accounts(\?|$)/,
    json([
      account("123456789012", "Payments Prod", true),
      account("111122223333", "Legacy Sandbox", false),
    ]),
  );
}

async function open(page: Page, path: string, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('main [data-slot="skeleton"]')).toHaveCount(0);
}

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  const b = await locator.boundingBox();
  if (!b) throw new Error("no layout box");
  return b;
}

function near(actual: number, expected: number, tolerance = 1) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

const panel = (page: Page, title: string) =>
  page
    .getByRole("heading", { level: 2, name: title })
    .locator("xpath=ancestor::*[@data-slot='card'][1]");

test.describe("fluid workspace", () => {
  test.beforeEach(async ({ context, page }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
  });

  // Overview KPI row: 1 / 2 / 3 / 5 across at 375 / 768 / 1024 / 1440 (and
  // still 5 on a wide screen).
  for (const [width, across] of [
    [375, 1],
    [768, 2],
    [1024, 3],
    [1440, 5],
    [1920, 5],
  ] as const) {
    test(`Overview KPI row is ${across} across at ${width}px`, async ({
      page,
    }) => {
      await open(page, `/dashboard?${QUERY}`, width);
      const cards = page
        .getByRole("group")
        .filter({ has: page.locator('[data-slot="card-title"]') });
      await expect(cards).toHaveCount(5);
      const tops = await cards.evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().top)),
      );
      const firstRow = tops.filter((t) => t === Math.min(...tops)).length;
      expect(firstRow).toBe(across);
    });
  }

  // Other KPI rows: one across below 768, then every card in one row.
  const OTHER_KPI_ROWS = [
    {
      name: "Team Detail",
      path: `/dashboard/teams/team-a?${QUERY}`,
      titles: ["Total cost", "Tokens"],
    },
    {
      name: "Department Detail",
      path: `/dashboard/departments/dept-eng?${QUERY}`,
      titles: ["Total cost", "Tokens", "Invocations"],
    },
  ];
  for (const { name, path, titles } of OTHER_KPI_ROWS) {
    for (const [width, stacked] of [
      [375, true],
      [767, true],
      [768, false],
      [1440, false],
      [1920, false],
    ] as const) {
      test(`${name} KPI row is ${stacked ? "one across" : "a single row"} at ${width}px`, async ({
        page,
      }) => {
        await open(page, path, width);
        const tops: number[] = [];
        for (const title of titles) {
          const b = await box(
            page.getByRole("group", { name: title, exact: true }),
          );
          tops.push(Math.round(b.y));
        }
        expect(new Set(tops).size).toBe(stacked ? titles.length : 1);
      });
    }
  }

  // Overview panel grid: 12 columns with a 16px gap from `lg`; one column
  // below. Row 1 is cost trend (8) + model distribution (4); row 2 is top
  // departments (8) + sync status (4).
  const PANEL_ROWS = [
    ["Cost trend", "Model distribution"],
    ["Top 5 departments", "Sync status"],
  ] as const;

  for (const width of [1024, 1440, 1920]) {
    test(`Overview panels sit on a 12-column grid with a 16px gap at ${width}px`, async ({
      page,
    }) => {
      await open(page, `/dashboard?${QUERY}`, width);
      for (const [wideTitle, narrowTitle] of PANEL_ROWS) {
        const wide = await box(panel(page, wideTitle));
        const narrow = await box(panel(page, narrowTitle));
        near(wide.y, narrow.y);
        near(narrow.x - (wide.x + wide.width), 16, 0.5);
        const total = wide.width + 16 + narrow.width;
        const column = (total - 11 * 16) / 12;
        near(wide.width, 8 * column + 7 * 16);
        near(narrow.width, 4 * column + 3 * 16);
      }
    });
  }

  for (const width of [375, 768, 1023]) {
    test(`Overview panels stack in one column at ${width}px`, async ({
      page,
    }) => {
      await open(page, `/dashboard?${QUERY}`, width);
      for (const [first, second] of PANEL_ROWS) {
        const a = await box(panel(page, first));
        const b = await box(panel(page, second));
        near(a.x, b.x);
        near(a.width, b.width);
        expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
      }
    });
  }

  // Panels and density: 16px padding on all four sides, measured from the
  // card's own boxes. Cards stretch to the tallest card in their grid row and
  // charts carry internal margins, so leaf-element extents would measure free
  // space, not padding. Left/right/top use the geometry of each direct slot's
  // content box; bottom is read from computed padding because grid-row
  // stretch adds free space under the last slot.
  async function contentInsets(card: Locator) {
    return card.evaluate((el) => {
      const px = (v: string) => parseFloat(v) || 0;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const inner = {
        left: r.left + px(cs.borderLeftWidth),
        right: r.right - px(cs.borderRightWidth),
        top: r.top + px(cs.borderTopWidth),
        bottom: r.bottom - px(cs.borderBottomWidth),
      };
      const slots = Array.from(el.children).filter((c) =>
        ["card-header", "card-content"].includes(
          c.getAttribute("data-slot") ?? "",
        ),
      );
      const contentBox = (slot: Element) => {
        const b = slot.getBoundingClientRect();
        const s = getComputedStyle(slot);
        return {
          left: b.left + px(s.borderLeftWidth) + px(s.paddingLeft),
          right: b.right - px(s.borderRightWidth) - px(s.paddingRight),
          top: b.top + px(s.borderTopWidth) + px(s.paddingTop),
          bottomEdge: b.bottom,
        };
      };
      const boxes = slots.map(contentBox);
      const firstBox = boxes[0];
      const lastBox = boxes[boxes.length - 1];
      const last = slots[slots.length - 1];
      if (!firstBox || !lastBox || !last)
        throw new Error("card has no header/content slot");
      return {
        lefts: boxes.map((b) => b.left - inner.left),
        rights: boxes.map((b) => inner.right - b.right),
        top: firstBox.top - inner.top,
        bottom: px(cs.paddingBottom) + px(getComputedStyle(last).paddingBottom),
        bottomClearance: inner.bottom - lastBox.bottomEdge,
      };
    });
  }

  function expectPadding(insets: Awaited<ReturnType<typeof contentInsets>>) {
    for (const v of [...insets.lefts, ...insets.rights]) near(v, 16);
    near(insets.top, 16);
    near(insets.bottom, 16);
    expect(insets.bottomClearance).toBeGreaterThanOrEqual(15);
  }

  test("KPI cards have 16px padding on all four sides", async ({ page }) => {
    await open(page, `/dashboard?${QUERY}`);
    const insets = await contentInsets(
      page.getByRole("group", { name: "Total Tokens", exact: true }),
    );
    expectPadding(insets);
  });

  for (const title of [
    "Cost trend",
    "Model distribution",
    "Top 5 departments",
    "Sync status",
  ]) {
    test(`Overview panel "${title}" has 16px padding on all four sides`, async ({
      page,
    }) => {
      await open(page, `/dashboard?${QUERY}`);
      const insets = await contentInsets(panel(page, title));
      expectPadding(insets);
    });
  }

  // Every table on a card surface (card background, 1px border-token border)
  // with 1px border-token row dividers and a hover highlight. Every page that
  // renders a table is covered once; the Departments list is cards, not a
  // table.
  const TABLE_PAGES = [
    { name: "Ranking", path: `/dashboard/ranking?${QUERY}` },
    { name: "Teams", path: `/dashboard/teams?${QUERY}` },
    { name: "Services", path: `/dashboard/services?${QUERY}` },
    { name: "Users", path: `/dashboard/users?${QUERY}` },
    {
      name: "Department Detail",
      path: `/dashboard/departments/dept-eng?${QUERY}`,
    },
    { name: "Team Detail", path: `/dashboard/teams/team-a?${QUERY}` },
    { name: "Settings", path: "/dashboard/settings" },
  ];
  for (const { name, path } of TABLE_PAGES) {
    test(`${name} tables sit on a card surface with dividers and row hover`, async ({
      page,
    }) => {
      await open(page, path);
      await expect(page.locator("main table").first()).toBeVisible();

      // Visually hidden chart data tables are skipped by size or by a clipped
      // (sr-only) ancestor.
      const reports = await page.evaluate(() => {
        const token = (prop: "backgroundColor" | "color", name: string) => {
          const probe = document.createElement("div");
          probe.style[prop] = `var(${name})`;
          document.body.appendChild(probe);
          const value = getComputedStyle(probe)[prop];
          probe.remove();
          return value;
        };
        const card = token("backgroundColor", "--color-card");
        const border = token("color", "--color-border");
        const inset = document.querySelector('[data-slot="sidebar-inset"]');
        return [...document.querySelectorAll("main table")].flatMap(
          (table, index) => {
            const r = table.getBoundingClientRect();
            if (r.width < 100 || r.height < 20) return [];
            let clipped = false;
            for (
              let el = table.parentElement;
              el && el.tagName.toLowerCase() !== "main";
              el = el.parentElement
            ) {
              const box = el.getBoundingClientRect();
              if (box.width <= 2 || box.height <= 2) {
                clipped = true;
                break;
              }
            }
            if (clipped) return [];
            let onCard = false;
            for (
              let el = table.parentElement;
              el && el !== inset;
              el = el.parentElement
            ) {
              const cs = getComputedStyle(el);
              const sides = [
                [cs.borderTopWidth, cs.borderTopColor],
                [cs.borderRightWidth, cs.borderRightColor],
                [cs.borderBottomWidth, cs.borderBottomColor],
                [cs.borderLeftWidth, cs.borderLeftColor],
              ];
              if (
                cs.backgroundColor === card &&
                sides.every(([w, c]) => w === "1px" && c === border)
              ) {
                onCard = true;
                break;
              }
            }
            const row = table.querySelectorAll("tbody tr")[0];
            const rcs = row ? getComputedStyle(row) : null;
            return [
              {
                index,
                onCard,
                bodyRows: table.querySelectorAll("tbody tr").length,
                dividerWidth: rcs?.borderBottomWidth ?? "",
                dividerColor: rcs?.borderBottomColor ?? "",
                border,
              },
            ];
          },
        );
      });

      expect(reports.length, "no visible tables found").toBeGreaterThan(0);
      for (const report of reports) {
        const label = `${name} table #${report.index}`;
        expect(report.onCard, `${label} is not on a card surface`).toBe(true);
        expect(report.bodyRows, `${label} needs >= 2 rows`).toBeGreaterThan(1);
        expect(report.dividerWidth, `${label} row divider`).toBe("1px");
        expect(report.dividerColor, `${label} divider colour`).toBe(
          report.border,
        );

        const row = page
          .locator("main table")
          .nth(report.index)
          .locator("tbody tr")
          .first();
        const background = () =>
          row.evaluate((el) => getComputedStyle(el).backgroundColor);
        const resting = await background();
        await row.hover();
        await expect
          .poll(background, { message: `${label} row hover` })
          .not.toBe(resting);
      }
    });
  }

  // Readable measure: 72ch cap on EmptyState description text and on the
  // Settings forms. The cap is read from computed style (ch resolves to px)
  // against a 72ch probe in the same font.
  async function maxWidthVsMeasure(target: Locator) {
    return target.evaluate((el) => {
      const probe = document.createElement("span");
      probe.style.cssText =
        "position:absolute;visibility:hidden;height:0;width:72ch";
      el.appendChild(probe);
      const measure = probe.getBoundingClientRect().width;
      probe.remove();
      return { maxWidth: getComputedStyle(el).maxWidth, measure };
    });
  }

  test("EmptyState description is capped at 72ch", async ({ page }) => {
    // Registered later, so it wins over the beforeEach /api/users fixture.
    await mockApi(page, { emptyUsers: true });
    await open(page, `/dashboard/users?${QUERY}`);
    const description = page.getByText("Try a wider date range.");
    const { maxWidth, measure } = await maxWidthVsMeasure(description);
    expect(maxWidth).not.toBe("none");
    expect(parseFloat(maxWidth)).toBeLessThanOrEqual(measure + 0.5);
  });

  test("the Settings account form is capped at 72ch", async ({ page }) => {
    await open(page, "/dashboard/settings");
    await page.getByRole("button", { name: /add account/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const { maxWidth, measure } = await maxWidthVsMeasure(
      dialog.locator("form"),
    );
    expect(maxWidth).not.toBe("none");
    expect(parseFloat(maxWidth)).toBeLessThanOrEqual(measure + 0.5);
  });

  test("the sidebar brand reads LLM Usage Lens", async ({ page }) => {
    await open(page, "/dashboard");
    const brand = page.getByRole("link", {
      name: "LLM Usage Lens — go to overview",
    });
    await expect(brand).toBeVisible();
    await expect(brand).toContainText("LLM Usage Lens");
    await expect(page.getByText("Bedrock Cost")).toHaveCount(0);
  });
});

// The label strings are unit-tested; this proves AppHeader passes the real
// session's roles and sign-in method through to the menu.
test.describe("user menu session details", () => {
  test("shows the role labels in GLOBAL_ROLES order and the sign-in method", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, {
      roles: ["internal-viewer", "internal-admin", "Reader"],
      authMethod: "local",
    });
    await mockApi(page);
    await open(page, "/dashboard");

    await page.getByRole("button", { name: "Open user menu" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toContainText("Admin, Viewer");
    await expect(menu).toContainText("Local login (dev)");
    await expect(menu).not.toContainText("Reader");
  });
});
