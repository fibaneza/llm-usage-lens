import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Source: Design System - "Source panels on Cost by team, Cost by user and
// Cost by service" (D17 a Bedrock panel "AWS-billed" and a LiteLLM panel
// "LiteLLM-reported", each in its own boundary, no mixed table; D18 the three
// figures; D19 + Q7 the Cost by service honest gap; M5-D3 "No AWS account";
// M5-D5 Sum of members on request only); implementation-phases M5 Verify
// ("targeted e2e once"); App Teams AT6. Rule 70.12: one targeted spec; every
// API is fulfilled from fixtures (Rule 60.24). Unit tests own the state
// matrix (Rule 60.24a); this spec adds only what a browser shows: the real
// shell, the request timing of the on-demand read, the 375px layout and axe.
const QUERY = "dateFrom=2026-01-11&dateTo=2026-01-20";

const ROW = {
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  invocations: 1_200,
};

const TEAMS = [
  {
    teamId: "team-pay",
    teamName: "Payments",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    cost: 600,
    modelCost: 600,
    nonModelCost: 0,
    serviceCount: 2,
    userCount: 3,
    ...ROW,
  },
  {
    teamId: "team-ledger",
    teamName: "Ledger",
    departmentId: "dept-fin",
    departmentName: "Finance",
    cost: 300,
    modelCost: 300,
    nonModelCost: 0,
    serviceCount: 1,
    userCount: 1,
    ...ROW,
  },
];

const SERVICES = [
  {
    serviceName: "payments-api",
    teamId: "team-pay",
    teamName: "Payments",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    cost: 60,
    costEstimated: true,
    ...ROW,
  },
];

const USERS = [
  {
    userId: "alice@example.test",
    teamId: "team-pay",
    teamName: "Payments",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    cost: 60,
    costEstimated: true,
    ...ROW,
  },
];

// LiteLLM spec - L6 counted-once fixture: combined 16.20 is not 15 + 6.20.
const COMBINED_ORG = {
  visibility: "show",
  configured: true,
  gatewayConfigured: true,
  bedrockExact: 15,
  gatewaySlice: 5,
  bedrockDirect: 10,
  litellm: 6.2,
  combined: 16.2,
  byProvider: [
    { provider: "bedrock", spend: 5.2 },
    { provider: "openai", spend: 1 },
  ],
  reconciliation: {
    litellmBedrock: 5.2,
    difference: -0.2,
    differencePct: -0.04,
  },
  costEstimated: false,
  provisional: false,
};

const ORG = {
  configured: true,
  totals: { spend: 42.5 },
  daily: [],
  litellmTeams: [],
  appTeams: [
    {
      teamId: "team-pay",
      teamName: "Payments",
      spendSource: "litellm-team",
      spend: 12.5,
    },
    {
      teamId: "team-open",
      teamName: "Open Crew",
      spendSource: "member-sum",
      spend: null,
      reason: "open-team",
    },
  ],
  enabledOperations: [],
};

const MEMBER_SUM = {
  connected: true,
  spendSource: "litellm-team",
  team: {
    alias: null,
    spend: 12.5,
    maxBudget: null,
    softBudget: null,
    budgetDuration: null,
    models: [],
    rpmLimit: null,
    tpmLimit: null,
  },
  daily: [],
  enabledOperations: [],
  memberSum: {
    total: 9,
    daily: [],
    coverage: { members: 2, matched: 1, unmatched: 1, pending: 0 },
    members: [
      { oid: "o1", name: "Ada", matched: true, spend: 9 },
      { oid: "o2", name: "Bob", matched: false },
    ],
  },
};

// Design System - LiteLLM client requests (unit FX1), T-FX5: without q the
// route answers the LIST shape (UsersListResponseSchema, D-LF1).
const LITELLM_USERS = {
  users: [
    {
      key: "u-1",
      linkState: "unlinked",
      appUser: null,
      litellmUser: {
        userId: "u-1",
        email: "lite@example.test",
        teams: [{ teamId: "t-1", teamName: "Platform" }],
      },
    },
  ],
  page: 1,
  pageSize: 25,
  hasMore: false,
  enabledOperations: [],
};

const fulfil = (data: unknown) => ({ json: { data } });

async function mockBedrock(page: Page) {
  await page.route(/\/api\/sync-status(\?|$)/, (r) =>
    r.fulfill(fulfil({ state: "never-synced" })),
  );
  await page.route(/\/api\/departments(\?|$)/, (r) =>
    r.fulfill(fulfil({ departments: [] })),
  );
  await page.route(/\/api\/teams(\?|$)/, (r) =>
    r.fulfill(fulfil({ teams: TEAMS })),
  );
  await page.route(/\/api\/services(\?|$)/, (r) =>
    r.fulfill(fulfil({ services: SERVICES })),
  );
  await page.route(/\/api\/users(\?|$)/, (r) =>
    r.fulfill(fulfil({ users: USERS })),
  );
  await page.route(/\/api\/access\/org-units(\?|$)/, (r) =>
    r.fulfill(
      fulfil({
        teams: [
          {
            id: "team-new",
            name: "Fresh Crew",
            departmentId: "dept-eng",
            hasAwsAccount: false,
          },
        ],
        departments: [{ id: "dept-eng", name: "Engineering" }],
      }),
    ),
  );
}

async function mockLiteLLM(page: Page, combined: unknown = COMBINED_ORG) {
  await page.route(/\/api\/litellm\/combined\/organisation(\?|$)/, (r) =>
    r.fulfill(fulfil(combined)),
  );
  await page.route(/\/api\/litellm\/org(\?|$)/, (r) => r.fulfill(fulfil(ORG)));
  await page.route(/\/api\/litellm\/users(\?|$)/, (r) =>
    r.fulfill(fulfil(LITELLM_USERS)),
  );
}

async function open(page: Page, path: string) {
  await page.goto(`${path}?${QUERY}`);
  await waitForHydration(page);
  await expect(page.getByRole("region", { name: "LiteLLM" })).toBeVisible();
}

async function expectNoBlockingViolations(page: Page) {
  await expect(page).toHaveTitle(/\S/);
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
}

async function expectNoHorizontalScroll(page: Page) {
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
}

test.describe("Usage source panels (M5)", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context);
  });

  test("Cost by team at 1440px: the three figures, two labelled panels, 'No AWS account', axe clean", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBedrock(page);
    await mockLiteLLM(page);
    await open(page, "/dashboard/teams");

    const figures = page.getByRole("group", { name: "Source totals" });
    // U-W5 (review m5-r1): role-scoped text, not test ids.
    await expect(figures.getByText("$900.00")).toBeVisible();
    await expect(figures.getByText("$6.20", { exact: true })).toBeVisible();
    await expect(
      figures.getByRole("group", { name: "Combined" }).getByText("$16.20"),
    ).toBeVisible();

    const bedrock = page.getByRole("region", { name: "Bedrock" });
    await expect(bedrock).toContainText("AWS-billed");
    await expect(bedrock.getByRole("link", { name: "Payments" })).toBeVisible();
    await expect(
      bedrock.getByRole("columnheader", { name: /LiteLLM|Combined/ }),
    ).toHaveCount(0);
    const created = bedrock.getByRole("table", {
      name: "Teams without an AWS account",
    });
    await expect(
      created.getByRole("row").filter({ hasText: "Fresh Crew" }),
    ).toContainText("No AWS account");

    const litellm = page.getByRole("region", { name: "LiteLLM" });
    await expect(litellm).toContainText("LiteLLM-reported");
    await expect(litellm).toContainText("$42.50");
    await expect(
      page.getByRole("region", { name: "Combined with LiteLLM" }),
    ).toHaveCount(0);
    await expectNoBlockingViolations(page);
  });

  test("Cost by team: Sum of members is requested only on a press (AT6) and works for a linked and an open team", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBedrock(page);
    await mockLiteLLM(page);
    const teamReads: URL[] = [];
    await page.route(/\/api\/litellm\/teams\//, (r) => {
      teamReads.push(new URL(r.request().url()));
      return r.fulfill(fulfil(MEMBER_SUM));
    });
    await open(page, "/dashboard/teams");

    const litellm = page.getByRole("region", { name: "LiteLLM" });
    const linked = litellm.getByRole("button", {
      name: "Sum of members for Payments",
    });
    const openCrew = litellm.getByRole("button", {
      name: "Sum of members for Open Crew",
    });
    await expect(linked).toBeVisible();
    await expect(openCrew).toBeVisible();
    expect(teamReads).toHaveLength(0);

    await linked.click();
    await expect(
      litellm.getByText("Sum of members for Payments:", { exact: false }),
    ).toBeAttached();
    await expect(litellm.getByRole("row", { name: /Payments/ })).toContainText(
      "$9.00",
    );
    expect(teamReads).toHaveLength(1);
    expect(teamReads[0]?.pathname).toBe("/api/litellm/teams/team-pay");
    expect(teamReads[0]?.searchParams.get("include")).toBe("memberSum");

    await openCrew.click();
    await expect.poll(() => teamReads.length).toBe(2);
    expect(teamReads[1]?.pathname).toBe("/api/litellm/teams/team-open");
  });

  test("Cost by team at 375px: card lists, no horizontal scroll, axe clean", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockBedrock(page);
    await mockLiteLLM(page);
    await open(page, "/dashboard/teams");
    await expect(
      page.getByRole("list", { name: "App teams (LiteLLM)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Teams without an AWS account" }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoBlockingViolations(page);
  });

  test("a LiteLLM outage leaves the Bedrock panel working (D17)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBedrock(page);
    const down = {
      status: 503,
      json: { error: { code: "LITELLM_UNAVAILABLE", message: "down" } },
    };
    await page.route(/\/api\/litellm\//, (r) => r.fulfill(down));
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    // Direct goto, not open(): open() waits for the LiteLLM region to be
    // visible, which an outage does not guarantee (U-W4, review m5-r1).
    await page.goto(`/dashboard/teams?${QUERY}`);
    await waitForHydration(page);
    const bedrock = page.getByRole("region", { name: "Bedrock" });
    await expect(bedrock.getByRole("link", { name: "Payments" })).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Source totals" }).getByText("$900.00"),
    ).toBeVisible();
    // The LiteLLM panel shows its own error state (U-W4) and the outage
    // throws no uncaught page error.
    await expect(page.getByRole("region", { name: "LiteLLM" })).toContainText(
      "LiteLLM unavailable",
    );
    expect(pageErrors).toEqual([]);
  });

  test("Cost by team with visibility 'warn': the double-count warning shows and axe is clean (U-W1, review m5-r1; LiteLLM spec - Combined usage States)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBedrock(page);
    await mockLiteLLM(page, {
      ...COMBINED_ORG,
      visibility: "warn",
      gatewayConfigured: false,
    });
    await open(page, "/dashboard/teams");
    await expect(
      page
        .getByRole("group", { name: "Source totals" })
        .getByRole("status")
        .filter({ hasText: "gateway not configured" }),
    ).toContainText("totals may double count");
    await expectNoBlockingViolations(page);
  });

  test("Cost by team at 375px: pressing Sum of members and opening the details stays inside the viewport, axe clean (U-W2, review m5-r1; AT6, M5-D5)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockBedrock(page);
    await mockLiteLLM(page);
    await page.route(/\/api\/litellm\/teams\//, (r) =>
      r.fulfill(fulfil(MEMBER_SUM)),
    );
    await open(page, "/dashboard/teams");
    const list = page.getByRole("list", { name: "App teams (LiteLLM)" });
    await list
      .getByRole("button", { name: "Sum of members for Payments" })
      .click();
    await expect(
      list.getByText("Sum of members for Payments:", { exact: false }),
    ).toBeAttached();
    await list.getByText(/^Members \(/).click();
    await expect(list.getByText("Ada")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoBlockingViolations(page);
  });

  test("Cost by user at 375px: a populated LiteLLM users list stays inside the viewport, axe clean (U-W3, review m5-r1; M5-D4)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockBedrock(page);
    await mockLiteLLM(page);
    await open(page, "/dashboard/users");
    await expect(
      page
        .getByRole("list", { name: "LiteLLM users" })
        .getByText("lite@example.test"),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoBlockingViolations(page);
  });

  test("Cost by user at 1440px: the LiteLLM users list says 'Hidden' under the cap and points to Management", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBedrock(page);
    await mockLiteLLM(page);
    await open(page, "/dashboard/users");

    const bedrock = page.getByRole("region", { name: "Bedrock" });
    await expect(bedrock).toContainText("alice@example.test");
    await expect(bedrock).not.toContainText("lite@example.test");
    const litellm = page.getByRole("region", { name: "LiteLLM" });
    const row = litellm.getByRole("row", { name: /lite@example\.test/ });
    await expect(row).toContainText("Hidden");
    await expect(row).not.toContainText("$0");
    await expect(
      litellm.getByRole("link", {
        name: "Management → LiteLLM → LiteLLM users",
      }),
    ).toHaveAttribute("href", /\/dashboard\/manage\/litellm\/users$/);
    await expectNoBlockingViolations(page);
  });

  test("T-FX5 Cost by user with a list-shaped users answer: the LiteLLM users render and no alert shows (Design System - LiteLLM client requests)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBedrock(page);
    await mockLiteLLM(page);
    await open(page, "/dashboard/users");
    const litellm = page.getByRole("region", { name: "LiteLLM" });
    await expect(litellm.getByText("lite@example.test")).toBeVisible();
    await expect(litellm.getByRole("alert")).toHaveCount(0);
  });

  test("Cost by service at 1440px and 375px: the honest gap line and the provider split, no service rows from LiteLLM", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBedrock(page);
    await mockLiteLLM(page);
    await open(page, "/dashboard/services");

    const litellm = page.getByRole("region", { name: "LiteLLM" });
    await expect(litellm.getByRole("note")).toContainText(
      "LiteLLM does not report cost by service.",
    );
    await expect(
      litellm.getByRole("table", { name: "LiteLLM spend by provider" }),
    ).toContainText("openai");
    await expect(litellm).not.toContainText("payments-api");
    await expectNoBlockingViolations(page);

    await page.setViewportSize({ width: 375, height: 812 });
    await expectNoHorizontalScroll(page);
    await expectNoBlockingViolations(page);
  });
});
