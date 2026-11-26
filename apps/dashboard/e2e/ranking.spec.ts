import { readFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  type Download,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Phase 4.2 Ranking (implementation-phases — Phase 4.2 Verify: "all 4 tabs
// load, sorting works, model filter updates results, CSV exports correctly";
// Design System — Ranking Page; Rule 40.6 breakpoints; Rule 20.12). The
// browser-side requests to /api/ranking are fulfilled from fixtures so the
// assertions are deterministic and independent of DynamoDB Local (Rule 60.24).
const RANKING_URL = /\/api\/ranking(\?|$)/;
const SYNC_STATUS_URL = /\/api\/sync-status(\?|$)/;

// Hard-coded rather than derived from lib/date-range so the spec does not
// trust the code under test: the 10 days before 2026-01-11 are 01-01..01-10.
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PREVIOUS = { dateFrom: "2026-01-01", dateTo: "2026-01-10" };
const PAGE_URL = `/dashboard/ranking?dateFrom=${RANGE.dateFrom}&dateTo=${RANGE.dateTo}`;

type Tab = "departments" | "teams" | "services" | "users";
type Row = {
  id: string;
  name: string;
  cost: number;
  costEstimated: boolean;
  inputTokens: number;
  outputTokens: number;
  invocations: number;
};

function row(
  id: string,
  name: string,
  cost: number,
  invocations: number,
  costEstimated = false,
): Row {
  return {
    id,
    name,
    cost,
    costEstimated,
    inputTokens: cost * 1_000,
    outputTokens: cost * 500,
    invocations,
  };
}

// Departments: cost order is Engineering, Data Science, Marketing, Legal;
// invocation order (descending) is Data Science, Engineering, Legal, Marketing,
// so each sort reorders the rows.
const CURRENT: Record<Tab, Row[]> = {
  departments: [
    row("dept-eng", "Engineering", 600, 1_200),
    row("dept-data", "Data Science", 300, 2_500),
    row("dept-mkt", "Marketing", 60, 300),
    row("dept-legal", "Legal", 40, 800),
  ],
  teams: [
    row("team-platform", "Platform", 500, 900),
    row("team-ml", "ML Research", 300, 1_500),
    row("team-growth", "Growth", 100, 200),
  ],
  services: [
    row("svc-chat", "chatbot", 450, 4_000, true),
    row("svc-search", "search-api", 250, 1_000, true),
    row("svc-docs", "doc-summarizer", 90, 500, true),
  ],
  users: [
    row("u-alice", "Alice Nguyen", 220, 700, true),
    row("u-bob", "Bob Okafor", 140, 1_900, true),
    row("u-carol", "Carol Diaz", 30, 100, true),
  ],
};

const PREVIOUS_ROWS: Record<Tab, Row[]> = {
  departments: [
    row("dept-eng", "Engineering", 500, 1_000),
    row("dept-data", "Data Science", 600, 2_000),
  ],
  teams: [row("team-platform", "Platform", 400, 800)],
  services: [row("svc-chat", "chatbot", 300, 3_000, true)],
  users: [row("u-alice", "Alice Nguyen", 200, 600, true)],
};

// A different set for the Claude Sonnet filter: Engineering is gone.
const SONNET_DEPARTMENTS: Row[] = [
  row("dept-data", "Data Science", 90, 700),
  row("dept-support", "Support", 10, 50),
];

const NAMES = [
  ...Object.values(CURRENT).flatMap((rows) => rows.map((r) => r.name)),
  "Support",
];

type RankingRequest = {
  tab: string | null;
  model: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  limit: string | null;
};

async function mockApi(page: Page): Promise<RankingRequest[]> {
  const requests: RankingRequest[] = [];
  await page.route(SYNC_STATUS_URL, (route) =>
    route.fulfill({
      json: { data: { state: "never-synced" } },
    }),
  );
  await page.route(RANKING_URL, async (route) => {
    const url = new URL(route.request().url());
    const tab = (url.searchParams.get("tab") ?? "departments") as Tab;
    const model = url.searchParams.get("model");
    requests.push({
      tab: url.searchParams.get("tab"),
      model,
      dateFrom: url.searchParams.get("dateFrom"),
      dateTo: url.searchParams.get("dateTo"),
      limit: url.searchParams.get("limit"),
    });
    const isPrevious = url.searchParams.get("dateFrom") === PREVIOUS.dateFrom;
    const rows = isPrevious
      ? PREVIOUS_ROWS[tab]
      : model === "claude-sonnet" && tab === "departments"
        ? SONNET_DEPARTMENTS
        : CURRENT[tab];
    await route.fulfill({ json: { data: { tab, rows } } });
  });
  return requests;
}

function currentRequests(requests: RankingRequest[]): RankingRequest[] {
  return requests.filter((request) => request.dateFrom === RANGE.dateFrom);
}

function main(page: Page): Locator {
  return page.locator("main");
}

function table(page: Page): Locator {
  return main(page).getByRole("table");
}

// Below the md breakpoint (768px) each row collapses into a card (Design
// System - Responsive Tables). The list is named by the table's caption.
function cardList(page: Page): Locator {
  return main(page).getByRole("list", { name: "Cost ranking" });
}

function cards(page: Page): Locator {
  return cardList(page).getByRole("listitem");
}

async function cardNames(page: Page): Promise<string[]> {
  const texts = await cards(page).allTextContents();
  return texts.map((text) => NAMES.find((name) => text.includes(name)) ?? text);
}

function columnHeader(page: Page, name: RegExp): Locator {
  return table(page).getByRole("columnheader", { name });
}

// Names in table order. Rows are matched by the fixture name they contain.
async function visibleNames(page: Page): Promise<string[]> {
  const texts = await table(page).locator("tbody tr").allTextContents();
  return texts.map((text) => NAMES.find((name) => text.includes(name)) ?? text);
}

async function openRanking(
  page: Page,
  query = "",
  layout: "table" | "cards" = "table",
): Promise<void> {
  await page.goto(`${PAGE_URL}${query}`);
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Cost ranking" }),
  ).toBeVisible();
  await expect(layout === "table" ? table(page) : cardList(page)).toBeVisible();
}

async function readDownload(download: Download): Promise<string[]> {
  const path = await download.path();
  expect(path).not.toBeNull();
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

async function exportCsv(
  page: Page,
): Promise<{ filename: string; lines: string[] }> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    main(page).getByRole("button", { name: "Export CSV" }).click(),
  ]);
  return {
    filename: download.suggestedFilename(),
    lines: await readDownload(download),
  };
}

test.describe("ranking page", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  test("all four tabs load their own rows, update the URL and re-request", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const consoleErrors = collectConsoleErrors(page);
    const requests = await mockApi(page);

    await openRanking(page);
    await expect(
      page.getByRole("tab", { name: "Departments" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(await visibleNames(page)).toEqual([
      "Engineering",
      "Data Science",
      "Marketing",
      "Legal",
    ]);

    const tabs: Array<{ label: string; tab: Tab; names: string[] }> = [
      {
        label: "Teams",
        tab: "teams",
        names: ["Platform", "ML Research", "Growth"],
      },
      {
        label: "Services",
        tab: "services",
        names: ["chatbot", "search-api", "doc-summarizer"],
      },
      {
        label: "Users",
        tab: "users",
        names: ["Alice Nguyen", "Bob Okafor", "Carol Diaz"],
      },
      {
        label: "Departments",
        tab: "departments",
        names: ["Engineering", "Data Science", "Marketing", "Legal"],
      },
    ];
    for (const { label, tab, names } of tabs) {
      await page.getByRole("tab", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
      await expect(page.getByRole("tab", { name: label })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect.poll(() => visibleNames(page)).toEqual(names);
      expect(currentRequests(requests)).toContainEqual({
        tab,
        model: null,
        ...RANGE,
        limit: "100",
      });
      expect(requests).toContainEqual({
        tab,
        model: null,
        ...PREVIOUS,
        limit: "100",
      });
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("opens on the tab named in the URL and flags estimated costs on users", async ({
    page,
  }) => {
    await mockApi(page);

    await openRanking(page, "&tab=users");

    await expect(page.getByRole("tab", { name: "Users" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await visibleNames(page)).toEqual([
      "Alice Nguyen",
      "Bob Okafor",
      "Carol Diaz",
    ]);
    await expect(
      table(page)
        .getByText(/estimated/i)
        .or(table(page).getByLabel(/estimated/i))
        .or(table(page).locator('[title*="stimated" i]'))
        .first(),
    ).toBeAttached();
  });

  // Data Model - Non-model cost is account-level only: the user and service views
  // exclude Guardrail / Provisioned Throughput charges and say so.
  test("the Users and Services tabs carry the 'model usage only' note, Departments does not", async ({
    page,
  }) => {
    await mockApi(page);
    await openRanking(page, "&tab=users");

    const note = main(page)
      .getByText(/model usage only/i)
      .first();
    await expect(note).toBeVisible();
    await expect(main(page)).toContainText(/guardrail/i);
    await expect(main(page)).toContainText(/provisioned/i);

    await page.getByRole("tab", { name: "Services" }).click();
    await expect(page.getByRole("tab", { name: "Services" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect.poll(() => visibleNames(page)).toContain("chatbot");
    await expect(note).toBeVisible();

    await page.getByRole("tab", { name: "Departments" }).click();
    await expect.poll(() => visibleNames(page)).toContain("Engineering");
    await expect(main(page).getByText(/model usage only/i)).toHaveCount(0);
  });

  test("shows the change vs the previous period, with '—' for rows that have none", async ({
    page,
  }) => {
    await mockApi(page);
    await openRanking(page);

    const engineering = table(page).locator("tbody tr", {
      hasText: "Engineering",
    });
    await expect(
      engineering.getByRole("img", { name: "Up 20.0% vs previous period" }),
    ).toBeVisible();
    await expect(
      table(page)
        .locator("tbody tr", { hasText: "Data Science" })
        .getByRole("img", { name: "Down 50.0% vs previous period" }),
    ).toBeVisible();
    await expect(
      table(page)
        .locator("tbody tr", { hasText: "Marketing" })
        .locator("td")
        .last(),
    ).toHaveText("—");
  });

  test("sorting by Cost and then Invocations reorders the rows and sets aria-sort", async ({
    page,
  }) => {
    await mockApi(page);
    await openRanking(page);

    const cost = columnHeader(page, /^Cost/);
    const invocations = columnHeader(page, /^Invocations/);
    await expect(cost).toHaveAttribute("aria-sort", "descending");

    await cost.getByRole("button").click();
    await expect(cost).toHaveAttribute("aria-sort", "ascending");
    await expect
      .poll(() => visibleNames(page))
      .toEqual(["Legal", "Marketing", "Data Science", "Engineering"]);

    await invocations.getByRole("button").click();
    await expect(cost).toHaveAttribute("aria-sort", "none");
    await expect(invocations).not.toHaveAttribute("aria-sort", "none");
    const first = await invocations.getAttribute("aria-sort");
    expect(["ascending", "descending"]).toContain(first);
    const byInvocations = ["Marketing", "Legal", "Engineering", "Data Science"];
    await expect
      .poll(() => visibleNames(page))
      .toEqual(
        first === "ascending" ? byInvocations : [...byInvocations].reverse(),
      );

    await invocations.getByRole("button").click();
    await expect(invocations).toHaveAttribute(
      "aria-sort",
      first === "ascending" ? "descending" : "ascending",
    );
    await expect
      .poll(() => visibleNames(page))
      .toEqual(
        first === "ascending" ? [...byInvocations].reverse() : byInvocations,
      );
  });

  test("the Model filter changes the model param and the rows", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const consoleErrors = collectConsoleErrors(page);
    const requests = await mockApi(page);
    await openRanking(page);

    const model = main(page).getByRole("combobox", { name: "Model" });
    await expect(model).toContainText("All models");
    expect(requests.every((request) => request.model === null)).toBe(true);

    await model.click();
    await page.getByRole("option", { name: "Claude Sonnet" }).click();

    await expect(page).toHaveURL(/model=claude-sonnet/);
    await expect(model).toContainText("Claude Sonnet");
    await expect
      .poll(() => visibleNames(page))
      .toEqual(["Data Science", "Support"]);
    expect(currentRequests(requests)).toContainEqual({
      tab: "departments",
      model: "claude-sonnet",
      ...RANGE,
      limit: "100",
    });
    expect(requests).toContainEqual({
      tab: "departments",
      model: "claude-sonnet",
      ...PREVIOUS,
      limit: "100",
    });

    // Switching back asserts the URL and rows only, not a new request: the
    // all-models query is still fresh in the TanStack cache (client staleTime
    // of 5-10 minutes, Design System - Caching Strategy), so it is correctly
    // served without refetching.
    await model.click();
    await page.getByRole("option", { name: "All models" }).click();

    await expect(page).not.toHaveURL(/model=claude-sonnet/);
    await expect
      .poll(() => visibleNames(page))
      .toEqual(["Engineering", "Data Science", "Marketing", "Legal"]);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("Export CSV downloads ranking-<tab>-<dateFrom>-<dateTo>.csv with the table's rows", async ({
    page,
  }) => {
    await mockApi(page);
    await openRanking(page);

    const departments = await exportCsv(page);

    expect(departments.filename).toBe(
      `ranking-departments-${RANGE.dateFrom}-${RANGE.dateTo}.csv`,
    );
    expect(departments.lines).toHaveLength(1 + CURRENT.departments.length);
    const columns = (departments.lines[0] ?? "").split(",");
    for (const name of [
      "Name",
      "Cost",
      "Input Tokens",
      "Output Tokens",
      "Invocations",
    ]) {
      expect(columns).toContain(name);
    }
    expect(columns.indexOf("Name")).toBeLessThan(columns.indexOf("Cost"));
    expect(columns.indexOf("Cost")).toBeLessThan(
      columns.indexOf("Input Tokens"),
    );
    expect(columns.indexOf("Input Tokens")).toBeLessThan(
      columns.indexOf("Output Tokens"),
    );
    expect(columns.indexOf("Output Tokens")).toBeLessThan(
      columns.indexOf("Invocations"),
    );
    const first = (departments.lines[1] ?? "").split(",");
    expect(first[columns.indexOf("Name")]).toBe("Engineering");
    // Raw numbers: no currency symbol and no thousands separators.
    expect(first[columns.indexOf("Cost")]).toMatch(/^\d+(\.\d+)?$/);
    expect(Number(first[columns.indexOf("Cost")])).toBe(600);
    expect(Number(first[columns.indexOf("Input Tokens")])).toBe(600_000);
    expect(Number(first[columns.indexOf("Output Tokens")])).toBe(300_000);
    expect(Number(first[columns.indexOf("Invocations")])).toBe(1_200);

    await page.getByRole("tab", { name: "Users" }).click();
    await expect.poll(() => visibleNames(page)).toContain("Alice Nguyen");
    const users = await exportCsv(page);
    expect(users.filename).toBe(
      `ranking-users-${RANGE.dateFrom}-${RANGE.dateTo}.csv`,
    );
    expect(users.lines).toHaveLength(1 + CURRENT.users.length);
    expect(users.lines.join("\n")).toContain("Alice Nguyen");
    expect(users.lines.join("\n")).not.toContain("Engineering");
  });

  test("Export CSV holds the filtered and sorted rows and only the visible columns", async ({
    page,
  }) => {
    await mockApi(page);
    await openRanking(page);

    await columnHeader(page, /^Cost/).getByRole("button").click();
    await main(page).getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Invocations" }).click();
    await page.keyboard.press("Escape");
    await expect(columnHeader(page, /^Invocations/)).toHaveCount(0);
    // The shell's CommandMenu button is also labelled "Search" and sits inside
    // <main>, so target the table's own search box.
    await main(page)
      .getByRole("searchbox", { name: "Search by name" })
      .fill("ing");
    await expect
      .poll(() => visibleNames(page))
      .toEqual(["Marketing", "Engineering"]);

    const { lines } = await exportCsv(page);

    const columns = (lines[0] ?? "").split(",");
    expect(columns).not.toContain("Invocations");
    expect(columns).toContain("Cost");
    expect(lines).toHaveLength(3);
    expect((lines[1] ?? "").split(",")[columns.indexOf("Name")]).toBe(
      "Marketing",
    );
    expect((lines[2] ?? "").split(",")[columns.indexOf("Name")]).toBe(
      "Engineering",
    );
  });

  test("has no serious or critical axe violations on any tab", async ({
    page,
  }) => {
    await mockApi(page);
    await openRanking(page);

    for (const label of ["Departments", "Teams", "Services", "Users"]) {
      await page.getByRole("tab", { name: label }).click();
      await expect(page.getByRole("tab", { name: label })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(table(page).locator("tbody tr").first()).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const blocking = results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );

      expect(
        blocking.map((violation) => ({
          tab: label,
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map((node) => node.target.join(" ")),
        })),
      ).toEqual([]);
    }
  });
});

// The design-system breakpoints (Rule 40.6). From 768px up the ranking is a
// full table; below it each row is a card and nothing inside the page content
// may be wider than the viewport (Design System - Responsive Tables: "No
// horizontal scroll at any viewport"). The page itself never scrolls
// horizontally at any breakpoint.
const BREAKPOINTS = [
  { label: "mobile", width: 375, height: 812 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "laptop", width: 1024, height: 768 },
  { label: "desktop", width: 1440, height: 900 },
] as const;

const MD_BREAKPOINT = 768;

async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    return [...document.querySelectorAll("main *")]
      .filter((el) => el.getBoundingClientRect().right > limit + 1)
      .map((el) => {
        const classes =
          typeof el.className === "string" ? el.className.slice(0, 60) : "";
        return `${el.tagName.toLowerCase()}[${classes}] right=${Math.round(
          el.getBoundingClientRect().right,
        )} limit=${limit}`;
      });
  });
}

async function chooseSort(page: Page, label: string): Promise<void> {
  const control = main(page).getByRole("combobox", { name: /sort/i });
  const isNative = await control.evaluate((el) => el.tagName === "SELECT");
  if (isNative) {
    await control.selectOption({ label });
  } else {
    await control.click();
    await page.getByRole("option", { name: label }).click();
  }
}

test.describe("ranking page - responsive", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  for (const breakpoint of BREAKPOINTS) {
    const mobile = breakpoint.width < MD_BREAKPOINT;

    test(`shows ${mobile ? "cards" : "the table"} and no horizontal page scroll at ${breakpoint.width}px (${breakpoint.label})`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: breakpoint.width,
        height: breakpoint.height,
      });
      const clientErrors = collectConsoleErrors(page);
      page.on("pageerror", (error) => clientErrors.push(error.message));
      await mockApi(page);

      await openRanking(page, "", mobile ? "cards" : "table");
      await expect(
        page.getByRole("tab", { name: "Departments" }),
      ).toBeVisible();
      if (mobile) {
        await expect(cards(page)).toHaveCount(CURRENT.departments.length);
        await expect(table(page)).toHaveCount(0);
      } else {
        await expect(table(page).locator("tbody tr")).toHaveCount(
          CURRENT.departments.length,
        );
        await expect(cardList(page)).toHaveCount(0);
      }

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        `ranking overflows horizontally at ${breakpoint.width}px`,
      ).toBeLessThanOrEqual(overflow.clientWidth);
      expect(clientErrors).toEqual([]);
    });
  }

  test("at 375px each row is a card: name first, cost shown, nothing wider than the viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockApi(page);

    await openRanking(page, "", "cards");

    expect(await cardNames(page)).toEqual([
      "Engineering",
      "Data Science",
      "Marketing",
      "Legal",
    ]);
    const engineering = cards(page).filter({ hasText: "Engineering" });
    const text = (await engineering.textContent()) ?? "";
    expect(text.trimStart().startsWith("Engineering")).toBe(true);
    expect(text).toContain("$600.00");
    expect(text).toMatch(/Invocations\W*1,200/);
    expect(await overflowingElements(page)).toEqual([]);
  });

  // Design System - Anti-Patterns ("Horizontal scroll on any viewport") and Rule
  // 40.6: the four-tab strip fits the 375px content column outright rather than
  // scrolling inside a wrapper. Every tablist and every scroll container above
  // it must hold its content, and every tab must sit fully inside the viewport
  // and inside each clipping ancestor.
  test("at 375px the tab strip fits without scrolling and all four tabs are fully visible", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockApi(page);
    await openRanking(page, "", "cards");

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    for (const name of ["Departments", "Teams", "Services", "Users"]) {
      await expect(page.getByRole("tab", { name })).toBeVisible();
    }

    const report = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const describe = (el: Element) =>
        `${el.tagName.toLowerCase()}[${
          typeof el.className === "string" ? el.className.slice(0, 50) : ""
        }]`;
      const scrollers: string[] = [];
      const clipped: string[] = [];
      for (const tablist of document.querySelectorAll('[role="tablist"]')) {
        const containers: Element[] = [tablist];
        for (let el = tablist.parentElement; el; el = el.parentElement) {
          if (getComputedStyle(el).overflowX !== "visible") containers.push(el);
        }
        for (const el of containers) {
          if (el.scrollWidth > el.clientWidth + 1) {
            scrollers.push(
              `${describe(el)} scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth}`,
            );
          }
        }
        for (const tab of tablist.querySelectorAll('[role="tab"]')) {
          const box = tab.getBoundingClientRect();
          const label = tab.textContent ?? "";
          if (box.left < -1 || box.right > viewport + 1) {
            clipped.push(
              `${label} outside the viewport (${box.left}-${box.right})`,
            );
          }
          for (const el of containers) {
            const bounds = el.getBoundingClientRect();
            if (box.left < bounds.left - 1 || box.right > bounds.right + 1) {
              clipped.push(`${label} clipped by ${describe(el)}`);
            }
          }
        }
      }
      return { scrollers, clipped };
    });
    expect(report.scrollers, "the tab strip scrolls horizontally").toEqual([]);
    expect(report.clipped, "a tab is cut off").toEqual([]);
  });

  // Design System - Responsive Tables (amended 2026-11-16): the Columns toggle
  // is hidden in card-list mode.
  test("at 375px search, sort and export stay available on the cards, without the Columns toggle", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockApi(page);
    await openRanking(page, "", "cards");

    await expect(
      main(page).getByRole("searchbox", { name: "Search by name" }),
    ).toBeVisible();
    await expect(
      main(page).getByRole("button", { name: "Columns" }),
    ).toHaveCount(0);
    await expect(
      main(page).getByRole("button", { name: "Export CSV" }),
    ).toBeVisible();
    await expect(
      main(page).getByRole("combobox", { name: /sort/i }),
    ).toBeVisible();

    // T-FX8 (Design System - NativeSelect): the card sort control's chevron
    // stays inside its select, 8px or more from the right edge.
    const sort = main(page).getByRole("combobox", { name: /sort/i });
    const chevron = sort.locator("xpath=..").locator("svg");
    await expect(chevron).toHaveCount(1);
    const sb = await sort.boundingBox();
    const cb = await chevron.boundingBox();
    expect(sb).not.toBeNull();
    expect(cb).not.toBeNull();
    if (sb !== null && cb !== null) {
      expect(cb.x).toBeGreaterThanOrEqual(sb.x);
      expect(sb.x + sb.width - (cb.x + cb.width)).toBeGreaterThanOrEqual(8);
    }

    await chooseSort(page, "Invocations");
    const byInvocations = ["Marketing", "Legal", "Engineering", "Data Science"];
    await expect
      .poll(async () => {
        const names = await cardNames(page);
        return (
          names.join() === byInvocations.join() ||
          names.join() === [...byInvocations].reverse().join()
        );
      })
      .toBe(true);

    await main(page)
      .getByRole("searchbox", { name: "Search by name" })
      .fill("ing");
    await expect
      .poll(() => cardNames(page))
      .toEqual(expect.arrayContaining(["Engineering", "Marketing"]));
    await expect(cards(page)).toHaveCount(2);

    const { lines } = await exportCsv(page);
    expect(lines).toHaveLength(3);
    expect(lines.join("\n")).toContain("Marketing");
    expect(lines.join("\n")).not.toContain("Legal");
  });
});

// Design System - Responsive Tables: "≥ md: Full table - all columns" and "No
// horizontal scroll at any viewport". With the sidebar open the content column
// is far narrower than the viewport (about 490px at 768px, 746px at 1024px), so
// the table must fit that column rather than scroll inside it. The fixture uses
// long names and large figures, and the Users tab adds the Estimated badge to
// Cost -- the widest realistic content.
const COLUMN_HEADERS = [
  "Rank",
  "Name",
  "Cost",
  "Input Tokens",
  "Output Tokens",
  "Invocations",
  "% of Total",
  "Trend",
] as const;

function wideRow(
  id: string,
  name: string,
  cost: number,
  costEstimated: boolean,
): Row {
  return {
    id,
    name,
    cost,
    costEstimated,
    inputTokens: 98_765_432,
    outputTokens: 87_654_321,
    invocations: 12_345_678,
  };
}

const WIDE: Record<"departments" | "users", Row[]> = {
  departments: [
    wideRow("dept-a", "Enterprise Platform Engineering", 123_456.78, false),
    wideRow("dept-b", "Corporate Data Science and Analytics", 98_765.43, false),
    wideRow("dept-c", "Customer Support Operations", 12_345.67, false),
  ],
  users: [
    wideRow("u-a", "Bartholomew Wellington-Smythe", 123_456.78, true),
    wideRow("u-b", "Alexandria Montgomery-Hargreaves", 98_765.43, true),
    wideRow("u-c", "Christopher Nowak-Kowalski", 12_345.67, true),
  ],
};

// The previous period carries lower costs, so every row renders a real Trend
// badge instead of "—".
const WIDE_PREVIOUS: Record<"departments" | "users", Row[]> = {
  departments: WIDE.departments.map((r) => ({ ...r, cost: r.cost / 2 })),
  users: WIDE.users.map((r) => ({ ...r, cost: r.cost / 2 })),
};

async function mockWideApi(page: Page): Promise<void> {
  await page.route(SYNC_STATUS_URL, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(RANKING_URL, async (route) => {
    const url = new URL(route.request().url());
    const tab = (url.searchParams.get("tab") ?? "departments") as
      | "departments"
      | "users";
    const isPrevious = url.searchParams.get("dateFrom") === PREVIOUS.dateFrom;
    await route.fulfill({
      json: {
        data: { tab, rows: isPrevious ? WIDE_PREVIOUS[tab] : WIDE[tab] },
      },
    });
  });
}

const FIT_VIEWPORTS = [
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

test.describe("ranking page - the full table fits its container from md up", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  for (const viewport of FIT_VIEWPORTS) {
    for (const tab of ["departments", "users"] as const) {
      test(`${tab} table with long names and large figures fits without scrolling at ${viewport.width}px`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await mockWideApi(page);

        await openRanking(page, `&tab=${tab}`);
        await expect(table(page).locator("tbody tr")).toHaveCount(
          WIDE[tab].length,
        );

        const fit = await main(page)
          .locator('[data-slot="table-container"]')
          .evaluate((el) => ({
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          }));
        expect(
          fit.scrollWidth,
          `${tab} table scrolls inside its container at ${viewport.width}px ` +
            `(table ${fit.scrollWidth}px in a ${fit.clientWidth}px container)`,
        ).toBeLessThanOrEqual(fit.clientWidth + 1);

        const pageOverflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(pageOverflow.scrollWidth).toBeLessThanOrEqual(
          pageOverflow.clientWidth,
        );

        // "all columns": nothing is dropped to make the table fit.
        await expect(table(page).getByRole("columnheader")).toHaveCount(
          COLUMN_HEADERS.length,
        );
        for (const name of COLUMN_HEADERS) {
          await expect(
            table(page).getByRole("columnheader", { name }),
          ).toBeVisible();
        }
      });
    }
  }
});
