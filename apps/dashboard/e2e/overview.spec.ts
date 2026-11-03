import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Phase 4.1 Overview (implementation-phases — Phase 4.1 Verify: "page renders
// with seed data, skeletons show during load, date filter updates all
// sections"; Design System — Overview Page; Rule 20.9). The browser-side
// requests to /api/overview and /api/sync-status are fulfilled from fixtures so
// the assertions are deterministic and independent of whatever DynamoDB Local
// holds (Rule 60.24 — no flaky data); one test runs against the real route.
const OVERVIEW_URL = /\/api\/overview(\?|$)/;
const SYNC_STATUS_URL = /\/api\/sync-status(\?|$)/;

// UTC calendar day `offset` days from today (Rule 20.1). Computed here, not
// imported from lib/date-range, so the spec does not trust the code under test.
function utcDay(offset: number): string {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + offset,
    ),
  )
    .toISOString()
    .slice(0, 10);
}

// A preset ends today and spans `days` inclusive days; its comparison period is
// the same length ending the day before it starts.
function presetRange(days: number) {
  return { dateFrom: utcDay(-(days - 1)), dateTo: utcDay(0) };
}

function priorRange(days: number) {
  return { dateFrom: utcDay(-(2 * days - 1)), dateTo: utcDay(-days) };
}

const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const RANGE_QUERY = `dateFrom=${RANGE.dateFrom}&dateTo=${RANGE.dateTo}`;

function overviewBody(overrides: Record<string, unknown> = {}) {
  return {
    data: {
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
        { category: "provisioned-throughput", cost: 200, recurring: true },
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
        {
          departmentId: "dept-data",
          departmentName: "Data Science",
          cost: 434.56,
        },
      ],
      ...overrides,
    },
  };
}

function syncedBody(minutesAhead = 42) {
  // Half a minute of slack so the label reads the same whole-minute value
  // regardless of how quickly the page loads.
  const next = new Date(Date.now() + (minutesAhead * 60 + 30) * 1000);
  return {
    data: {
      state: "synced",
      status: {
        lastRunAt: new Date(next.getTime() - 3_600_000).toISOString(),
        nextScheduledAt: next.toISOString(),
        status: "success",
        accountsTotal: 5,
        accountsSuccess: 5,
        accountsFailed: 0,
        errors: [],
        durationMs: 12_000,
      },
    },
  };
}

const NEVER_SYNCED_BODY = { data: { state: "never-synced" } };

async function fulfillJson(
  page: Page,
  url: RegExp,
  body: unknown,
  status = 200,
) {
  await page.route(url, (route) =>
    route.fulfill({ status, contentType: "application/json", json: body }),
  );
}

function metric(page: Page, name: string): Locator {
  return page
    .getByRole("region", { name, exact: true })
    .or(page.getByRole("group", { name, exact: true }));
}

// Page content is everything in <main> except the top bar (<header>, which
// holds its own sync badge, timer and skeletons). Scoping to it also excludes
// Next's route announcer, a role="alert" node outside <main> on every page.
function content(page: Page): Locator {
  return page.locator("main > :not(header)");
}

const SKELETONS = 'main > :not(header) [data-slot="skeleton"]';

// Each chart ships a visually hidden data table (`div.sr-only`, named by its
// caption) next to its role="img" figure (Design System - Charts and Data).
// Those tables are the screen-reader face of the chart, so asserting on them
// proves which data the chart actually rendered. Scoped to <main>.
function chartTable(page: Page, caption: RegExp): Locator {
  return page.locator("main").getByRole("table", { name: caption });
}

const TREND_CAPTION = /cost trend/i;
const MODEL_CAPTION = /model distribution/i;
const DEPARTMENT_CAPTION = /department/i;

test.describe("overview page", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  test("renders the five sections from /api/overview and /api/sync-status", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const consoleErrors = collectConsoleErrors(page);
    await fulfillJson(page, OVERVIEW_URL, overviewBody());
    await fulfillJson(page, SYNC_STATUS_URL, syncedBody());

    await page.goto(`/dashboard?${RANGE_QUERY}`);
    await waitForHydration(page);

    // 1. KPI row
    for (const title of [
      "Total Cost",
      "Total Tokens",
      "Total Invocations",
      "Most Used Model",
      "Active Accounts",
    ]) {
      await expect(metric(page, title)).toBeVisible();
    }
    const totalCost = metric(page, "Total Cost");
    await expect(totalCost).toContainText("$1,234.56");
    await expect(totalCost).toContainText(
      /Model \$1,000\.00\s*·\s*Non-model \$234\.56/,
    );
    await expect(totalCost).toContainText("Bedrock service charges only");
    await expect(totalCost).toContainText(/recurring/i);
    await expect(metric(page, "Most Used Model")).toContainText("Claude Opus");

    // 2-4. Charts, each with an accessible name
    await expect(
      page.getByRole("img", { name: /cost trend/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /department/i }).first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("img", { name: /model (distribution|breakdown)/i })
        .first(),
    ).toBeVisible();

    // 5. Sync status with a live countdown
    await expect(
      content(page)
        .getByText(/sync status/i)
        .first(),
    ).toBeVisible();
    await expect(
      content(page)
        .getByText(/^Next sync in \d+ min$/)
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("timer", { name: /^Next sync in \d+ min$/ }).first(),
    ).toBeVisible();

    await expect(content(page).getByRole("alert")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("shows the neutral 'No sync yet' state when SyncStatus is missing", async ({
    page,
  }) => {
    await fulfillJson(page, OVERVIEW_URL, overviewBody());
    await fulfillJson(page, SYNC_STATUS_URL, NEVER_SYNCED_BODY);

    await page.goto(`/dashboard?${RANGE_QUERY}`);
    await waitForHydration(page);

    await expect(
      content(page)
        .getByText(/no sync yet/i)
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("timer", { name: "Next sync: pending" }),
    ).toBeVisible();
    await expect(content(page).getByRole("alert")).toHaveCount(0);
  });

  test("shows skeletons while /api/overview is slow, then the content", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(OVERVIEW_URL, async (route) => {
      await gate;
      await route.fulfill({ json: overviewBody() });
    });
    await fulfillJson(page, SYNC_STATUS_URL, syncedBody());

    try {
      await page.goto(`/dashboard?${RANGE_QUERY}`);
      await waitForHydration(page);

      // KPI row + three chart sections each hold their own skeleton.
      await expect
        .poll(() => page.locator(SKELETONS).count())
        .toBeGreaterThanOrEqual(4);
      await expect(metric(page, "Total Cost")).toHaveCount(0);
    } finally {
      release();
    }

    await expect(metric(page, "Total Cost")).toContainText("$1,234.56");
    await expect(page.locator(SKELETONS)).toHaveCount(0);
  });

  test("a failing /api/overview shows per-section alerts and leaves sync status intact", async ({
    page,
  }) => {
    // A 4xx is not retried (QueryProvider), so the fallback appears promptly.
    await fulfillJson(
      page,
      OVERVIEW_URL,
      { error: { code: "BAD_REQUEST", message: "bad range" } },
      400,
    );
    await fulfillJson(page, SYNC_STATUS_URL, syncedBody());

    await page.goto(`/dashboard?${RANGE_QUERY}`);
    await waitForHydration(page);

    const alerts = content(page).getByRole("alert");
    await expect(alerts).toHaveCount(4);
    await expect(alerts.first()).toContainText(/couldn.t load/i);
    await expect(
      alerts.first().getByRole("button", { name: /retry/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("timer", { name: /^Next sync in \d+ min$/ }).first(),
    ).toBeVisible();
  });

  test("changing the date preset requests the new range and updates every section", async ({
    page,
  }) => {
    const seven = presetRange(7);
    const thirty = presetRange(30);
    const requested: Array<{ dateFrom: string | null; dateTo: string | null }> =
      [];
    // The 7-day fixture shares no model, no day and no cost with the 30-day
    // one (Haiku + Other models vs Opus + Sonnet), so a stale chart is visible.
    const yesterday = utcDay(-1);
    const today = utcDay(0);
    const sevenDay = overviewBody({
      totalCost: 77.7,
      modelCost: 77.7,
      nonModelCost: 0,
      nonModelByCategory: [],
      mostUsedModel: "claude-haiku",
      byModel: [
        {
          model: "claude-haiku",
          cost: 50.25,
          inputTokens: 100_000,
          outputTokens: 50_000,
          invocations: 300,
        },
        {
          model: "other",
          cost: 27.45,
          inputTokens: 40_000,
          outputTokens: 20_000,
          invocations: 100,
        },
      ],
      dailyTrend: [
        {
          date: yesterday,
          cost: 38.7,
          modelCost: 38.7,
          nonModelCost: 0,
          byModel: { "claude-haiku": 25.1, other: 13.6 },
        },
        {
          date: today,
          cost: 39,
          modelCost: 39,
          nonModelCost: 0,
          byModel: { "claude-haiku": 25.15, other: 13.85 },
        },
      ],
      topDepartments: [
        {
          departmentId: "dept-mkt",
          departmentName: "Marketing",
          cost: 77.7,
        },
      ],
    });
    await page.route(OVERVIEW_URL, async (route) => {
      const url = new URL(route.request().url());
      requested.push({
        dateFrom: url.searchParams.get("dateFrom"),
        dateTo: url.searchParams.get("dateTo"),
      });
      const isSevenDay = url.searchParams.get("dateFrom") === seven.dateFrom;
      await route.fulfill({
        json: isSevenDay ? sevenDay : overviewBody(),
      });
    });
    await fulfillJson(page, SYNC_STATUS_URL, syncedBody());

    // No range in the URL -> the default 30-day preset.
    await page.goto("/dashboard");
    await waitForHydration(page);
    await expect(metric(page, "Total Cost")).toContainText("$1,234.56");
    expect(requested).toContainEqual(thirty);
    expect(requested).toContainEqual(priorRange(30));

    // Baseline: every chart shows the 30-day fixture, so the "gone" checks
    // after the click prove a replacement rather than a never-rendered value.
    await expect(chartTable(page, TREND_CAPTION)).toContainText("Claude Opus");
    await expect(chartTable(page, TREND_CAPTION)).toContainText("2026-01-19");
    await expect(chartTable(page, TREND_CAPTION)).toContainText("$350.00");
    await expect(chartTable(page, MODEL_CAPTION)).toContainText("Claude Opus");
    await expect(chartTable(page, MODEL_CAPTION)).toContainText("$700.00");
    await expect(chartTable(page, DEPARTMENT_CAPTION)).toContainText(
      "Engineering",
    );

    const sevenDayRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/overview" &&
        url.searchParams.get("dateFrom") === seven.dateFrom &&
        url.searchParams.get("dateTo") === seven.dateTo
      );
    });
    const previousRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      const previous = priorRange(7);
      return (
        url.pathname === "/api/overview" &&
        url.searchParams.get("dateFrom") === previous.dateFrom &&
        url.searchParams.get("dateTo") === previous.dateTo
      );
    });
    await page.getByRole("button", { name: "Last 7 days" }).click();
    await sevenDayRequest;
    await previousRequest;

    await expect(page).toHaveURL(new RegExp(`dateFrom=${seven.dateFrom}`));
    // KPI row
    await expect(metric(page, "Total Cost")).toContainText("$77.70");
    await expect(metric(page, "Most Used Model")).toContainText("Claude Haiku");

    // Top departments chart
    const departments = chartTable(page, DEPARTMENT_CAPTION);
    await expect(departments).toContainText("Marketing");
    await expect(departments).not.toContainText("Engineering");

    // Cost trend chart: the 7-day days, model set and per-day costs replace
    // the 30-day ones.
    const trend = chartTable(page, TREND_CAPTION);
    await expect(trend).toContainText("Claude Haiku");
    await expect(trend).toContainText("Other models");
    await expect(trend).toContainText(today);
    await expect(trend).toContainText(yesterday);
    await expect(trend).toContainText("$25.15");
    await expect(trend).toContainText("$13.85");
    await expect(trend).not.toContainText("Claude Opus");
    await expect(trend).not.toContainText("Claude Sonnet");
    await expect(trend).not.toContainText("2026-01-19");
    await expect(trend).not.toContainText("$350.00");
    await expect(trend.locator("tbody tr")).toHaveCount(2);

    // Model distribution chart
    const models = chartTable(page, MODEL_CAPTION);
    await expect(models).toContainText("Claude Haiku");
    await expect(models).toContainText("$50.25");
    await expect(models).toContainText("Other models");
    await expect(models).toContainText("$27.45");
    await expect(models).not.toContainText("Claude Opus");
    await expect(models).not.toContainText("Claude Sonnet");
    await expect(models).not.toContainText("$700.00");
    await expect(models).not.toContainText("Non-model charges");
    await expect(models.locator("tbody tr")).toHaveCount(2);

    await expect(page.getByText("Engineering")).toHaveCount(0);
  });

  test("renders from the real /api/overview (DynamoDB Local) without errors", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const consoleErrors = collectConsoleErrors(page);

    const overviewResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/overview",
    );
    await page.goto("/dashboard");
    await waitForHydration(page);

    expect((await overviewResponse).status()).toBe(200);
    for (const title of [
      "Total Cost",
      "Total Tokens",
      "Total Invocations",
      "Most Used Model",
      "Active Accounts",
    ]) {
      await expect(metric(page, title)).toBeVisible();
    }
    await expect(content(page).getByRole("alert")).toHaveCount(0);
    await expect(page.locator(SKELETONS)).toHaveCount(0);

    // Phase 4.1 Verify - "page renders with seed data": each chart is present
    // and its hidden data table carries real rows. Structure and non-emptiness
    // only, so the check survives a re-seed with different values.
    for (const [name, caption] of [
      [/cost trend/i, TREND_CAPTION],
      [/department/i, DEPARTMENT_CAPTION],
      [/model (distribution|breakdown)/i, MODEL_CAPTION],
    ] as const) {
      await expect(page.getByRole("img", { name }).first()).toBeVisible();
      const rows = chartTable(page, caption).locator("tbody tr");
      await expect(rows).not.toHaveCount(0);
      await expect(rows.first()).toContainText(/\$\d/);
    }
    await expect(content(page).getByText("No data yet")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

// The previous period of RANGE (same length, ending the day before it starts).
const PREVIOUS_FROM = "2026-01-01";

// Serves the current period from `overviewBody()` and the comparison period
// with a different total, so the Total Cost card renders a DeltaBadge.
async function fulfillOverviewWithPrevious(page: Page, previousTotal: number) {
  await page.route(OVERVIEW_URL, async (route) => {
    const url = new URL(route.request().url());
    const isPrevious = url.searchParams.get("dateFrom") === PREVIOUS_FROM;
    await route.fulfill({
      json: overviewBody(isPrevious ? { totalCost: previousTotal } : {}),
    });
  });
}

// The loaded page, not the skeleton page: every section has data and no
// skeleton remains in <main> (the header holds its own).
async function waitForLoadedOverview(page: Page) {
  await waitForHydration(page);
  await expect(metric(page, "Total Cost")).toContainText("$1,234.56");
  await expect(page.locator(SKELETONS)).toHaveCount(0);
  for (const name of [
    /cost trend/i,
    /department/i,
    /model (distribution|breakdown)/i,
  ]) {
    await expect(page.getByRole("img", { name }).first()).toBeVisible();
  }
}

// WCAG contrast ratio of an element's text colour against the first opaque
// ancestor background. Colours are normalised through a canvas so any CSS
// colour syntax resolves to sRGB.
async function textContrast(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const toRgba = (css: string): [number, number, number, number] => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d canvas context");
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
    };
    const luminance = ([r, g, b]: [number, number, number, number]) => {
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    let background: [number, number, number, number] = [255, 255, 255, 1];
    for (
      let node: Element | null = el;
      node !== null;
      node = node.parentElement
    ) {
      const candidate = toRgba(getComputedStyle(node).backgroundColor);
      if (candidate[3] > 0) {
        background = candidate;
        break;
      }
    }
    const text = toRgba(getComputedStyle(el).color);
    const a = text[3];
    const blended: [number, number, number, number] = [
      text[0] * a + background[0] * (1 - a),
      text[1] * a + background[1] * (1 - a),
      text[2] * a + background[2] * (1 - a),
      1,
    ];
    const [hi, lo] = [luminance(blended), luminance(background)].sort(
      (x, y) => y - x,
    ) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  });
}

// Seed-sized data: 30 days across every model plus non-model cost and five
// long-named departments, so the hidden chart tables are as wide as real ones.
const SEED_LIKE = {
  byModel: [
    {
      model: "claude-opus",
      cost: 500,
      inputTokens: 1,
      outputTokens: 1,
      invocations: 1,
    },
    {
      model: "claude-sonnet",
      cost: 300,
      inputTokens: 1,
      outputTokens: 1,
      invocations: 1,
    },
    {
      model: "claude-haiku",
      cost: 150,
      inputTokens: 1,
      outputTokens: 1,
      invocations: 1,
    },
    {
      model: "other",
      cost: 50,
      inputTokens: 1,
      outputTokens: 1,
      invocations: 1,
    },
  ],
  dailyTrend: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    cost: 40,
    modelCost: 30,
    nonModelCost: 10,
    byModel: {
      "claude-opus": 15,
      "claude-sonnet": 8,
      "claude-haiku": 5,
      other: 2,
    },
  })),
  topDepartments: [
    "Engineering Platform and Infrastructure",
    "Data Science and Machine Learning Research",
    "Customer Support Operations Tooling",
    "Marketing Analytics and Insights",
    "Finance and Procurement Systems",
  ].map((departmentName, i) => ({
    departmentId: `dept-${i}`,
    departmentName,
    cost: 500 - i * 50,
  })),
};

test.describe("overview page - loaded state", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  // Rule 40.6 / responsive no-scroll gate: the visually hidden chart tables
  // must not widen the document once the data has loaded.
  for (const width of [375, 768, 1024, 1440]) {
    test(`has no horizontal scroll once the data loads at ${width}px`, async ({
      page,
    }) => {
      await fulfillJson(page, OVERVIEW_URL, overviewBody(SEED_LIKE));
      await fulfillJson(page, SYNC_STATUS_URL, syncedBody());
      await page.setViewportSize({ width, height: 900 });

      await page.goto(`/dashboard?${RANGE_QUERY}`);
      await waitForLoadedOverview(page);

      const widths = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(
        widths.scrollWidth,
        `scrollWidth ${widths.scrollWidth} vs innerWidth ${widths.innerWidth} at ${width}px`,
      ).toBeLessThanOrEqual(widths.innerWidth);
    });
  }

  // Design System - UX Standards: contrast 4.5:1; Rule 60.30. Measured on the
  // loaded page (DeltaBadge and the sync badge only render with data), after
  // the badge text colour has settled past its 150 ms transition.
  const AXE_CASES = [
    {
      title: "a positive delta with a success badge",
      previousTotal: 1000,
      delta: "Up 23.5% vs previous period",
      status: "success",
      word: "Success",
    },
    {
      title: "a negative delta with a success badge",
      previousTotal: 1500,
      delta: "Down 17.7% vs previous period",
      status: "success",
      word: "Success",
    },
    {
      title: "a partial sync badge",
      previousTotal: 1000,
      delta: "Up 23.5% vs previous period",
      status: "partial",
      word: "Partial",
    },
    {
      title: "an error sync badge",
      previousTotal: 1000,
      delta: "Up 23.5% vs previous period",
      status: "error",
      word: "Error",
    },
  ] as const;

  for (const c of AXE_CASES) {
    test(`has no serious or critical axe violations with ${c.title}`, async ({
      page,
    }) => {
      await fulfillOverviewWithPrevious(page, c.previousTotal);
      await fulfillJson(page, SYNC_STATUS_URL, {
        data: {
          ...syncedBody().data,
          status: { ...syncedBody().data.status, status: c.status },
        },
      });
      await page.setViewportSize({ width: 1440, height: 900 });

      await page.goto(`/dashboard?${RANGE_QUERY}`);
      await waitForLoadedOverview(page);

      await expect(
        metric(page, "Total Cost").getByRole("img", { name: c.delta }),
      ).toBeVisible();
      const badge = page.getByRole("status", {
        name: new RegExp(`^Sync status: ${c.status}`),
      });
      await expect(badge).toBeVisible();
      const word = badge.getByText(c.word, { exact: true });
      await expect(word).toBeVisible();
      await expect
        .poll(() => textContrast(word), { timeout: 5_000 })
        .toBeGreaterThanOrEqual(4.5);

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

  // Rule 40.4: sections fail independently, but one successful refetch of the
  // shared query must not leave the other sections on a stale error view.
  test("a successful Retry recovers every overview section", async ({
    page,
  }) => {
    let failing = true;
    await page.route(OVERVIEW_URL, async (route) => {
      if (failing) {
        await route.fulfill({
          status: 400,
          json: { error: { code: "BAD_REQUEST", message: "bad range" } },
        });
        return;
      }
      await route.fulfill({ json: overviewBody() });
    });
    await fulfillJson(page, SYNC_STATUS_URL, syncedBody());

    await page.goto(`/dashboard?${RANGE_QUERY}`);
    await waitForHydration(page);
    const alerts = content(page).getByRole("alert");
    await expect(alerts).toHaveCount(4);

    failing = false;
    await alerts.first().getByRole("button", { name: /retry/i }).click();

    await expect(metric(page, "Total Cost")).toContainText("$1,234.56");
    await expect(alerts).toHaveCount(0);
    await expect(page.locator(SKELETONS)).toHaveCount(0);
  });
});
