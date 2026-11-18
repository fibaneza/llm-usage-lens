import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Source: docs/specs/2026-11-10-litellm.md - "Budget reset requests" (unit M4;
// Flow 1: "Request a budget reset" on My usage beside "Request a budget
// increase", which stays; Flow 3: the deciders approve or deny from the bell
// with an AlertDialog naming the person and the effect; Flow 5: the requester
// is told), MG-D11 (the control is absent when the server says the caller
// cannot request: hidden, never dead), MG-D13 (a bell in the top bar with the
// unread count); implementation-phases M4 Verify (slice A). Rule 70.12: one
// targeted spec for the button path; the rules (roles, BR1-BR10, expiry,
// ledger) are proved by the route integration tests, so every API response
// here is fulfilled from fixtures (Rule 60.24) and this spec adds only what a
// browser shows: the real shell, the two dialogs, the request sent, axe.
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const NOTIF_ID = `2026-11-14T09:00:00.000Z#${REQUEST_ID}`;

const ME = {
  oid: "e2e-user",
  email: "e2e@example.test",
  roles: ["internal-viewer"],
  usageIdentities: ["e2e@example.test"],
  global: false,
  memberTeamId: "team-a",
  memberTeamVisible: true,
  leadEmail: "lead@example.test",
  teamScopes: [],
  departmentScopes: [],
};
const ME_USAGE = {
  totals: { cost: 12.5, inputTokens: 1200, outputTokens: 300, invocations: 42 },
  daily: [
    {
      date: "2026-01-11",
      cost: 12.5,
      inputTokens: 1200,
      outputTokens: 300,
      invocations: 42,
    },
  ],
  byModel: [
    {
      model: "claude-sonnet",
      cost: 12.5,
      inputTokens: 1200,
      outputTokens: 300,
      invocations: 42,
    },
  ],
};
const LITELLM_ME = {
  linked: true,
  spend: 5,
  maxBudget: 100,
  daily: [{ date: "2026-01-12", spend: 5 }],
  keys: [],
  teams: [],
  enabledOperations: [],
};
const HIDDEN = {
  visibility: "hidden",
  configured: true,
  gatewayConfigured: false,
};

const VIEW = {
  id: REQUEST_ID,
  teamId: "team-a",
  teamName: "Payments",
  requester: {
    oid: "oid-ada",
    displayName: "Ada Lovelace",
    email: "ada@example.test",
  },
  reason: "Launch week <b>spike</b>",
  status: "open",
  createdAt: "2026-11-14T09:00:00.000Z",
  requestExpiresAt: "2026-11-21T09:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
};
const MINE_CAN = {
  teamId: "team-a",
  eligibility: { canRequest: true, reason: null },
  open: null,
  recent: [],
};
const NO_COUNTS = { teams: [], own: { count: 0, amount: 0 } };

const fulfil = (body: unknown) => ({ json: { data: body } });

async function mockShell(page: Page) {
  await page.route(/\/api\/sync-status(\?|$)/, (r) =>
    r.fulfill(fulfil({ state: "never-synced" })),
  );
  await page.route(/\/api\/me(\?|$)/, (r) => r.fulfill(fulfil(ME)));
  await page.route(/\/api\/me\/usage(\?|$)/, (r) =>
    r.fulfill(fulfil(ME_USAGE)),
  );
  await page.route(/\/api\/litellm\/me(\?|$)/, (r) =>
    r.fulfill(fulfil(LITELLM_ME)),
  );
  await page.route(/\/api\/litellm\/combined\/me(\?|$)/, (r) =>
    r.fulfill(fulfil(HIDDEN)),
  );
  await page.route(/\/api\/budget-resets(\?|$)/, (r) =>
    r.fulfill(fulfil(NO_COUNTS)),
  );
}

async function mockNotifications(page: Page, list: unknown) {
  await page.route(/\/api\/notifications(\?|$)/, (r) =>
    r.fulfill(fulfil(list)),
  );
  await page.route(/\/api\/notifications\/read(\?|$)/, (r) =>
    r.fulfill(fulfil({ updated: 1 })),
  );
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await waitForHydration(page);
}

async function expectNoBlockingViolations(page: Page) {
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

test.describe("My usage - Request a budget reset (M4, Flow 1)", () => {
  test("a member of a linked team asks with a reason; the request is sent without a team field and the control gives way to a waiting notice, axe clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockShell(page);
    await mockNotifications(page, { items: [], unreadCount: 0 });
    let mine: unknown = MINE_CAN;
    await page.route(/\/api\/budget-reset-requests\/mine(\?|$)/, (r) =>
      r.fulfill(fulfil(mine)),
    );
    const posted: unknown[] = [];
    await page.route(/\/api\/budget-reset-requests(\?|$)/, async (r) => {
      posted.push(r.request().postDataJSON());
      mine = {
        ...MINE_CAN,
        eligibility: { canRequest: false, reason: "open-request" },
        open: VIEW,
      };
      await r.fulfill({ status: 201, json: { data: VIEW } });
    });

    await open(page, "/dashboard/me");
    await expect(
      page.getByRole("link", { name: "Request a budget increase" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Request a budget reset" }).click();

    const dialog = page.getByRole("dialog", { name: "Request a budget reset" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/reason/i).fill("Launch week");
    await expectNoBlockingViolations(page);
    await dialog.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByText(/waiting for your team lead/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Request a budget reset" }),
    ).toHaveCount(0);
    expect(posted).toEqual([{ reason: "Launch week" }]);
  });

  // MG-D11 (hidden, never dead); review m4-r1 test NIT: the title named the
  // unlinked and no-team cases but only "disabled" was driven.
  for (const reason of ["disabled", "not-linked", "no-team"] as const) {
    test(`the control is absent when the server says the caller cannot request (reason ${reason}), and the increase link stays`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-viewer"] });
      await mockShell(page);
      await mockNotifications(page, { items: [], unreadCount: 0 });
      await page.route(/\/api\/budget-reset-requests\/mine(\?|$)/, (r) =>
        r.fulfill(
          fulfil({
            ...MINE_CAN,
            eligibility: { canRequest: false, reason },
          }),
        ),
      );
      await open(page, "/dashboard/me");
      await expect(
        page.getByRole("link", { name: "Request a budget increase" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Request a budget reset" }),
      ).toHaveCount(0);
    });
  }
});

test.describe("Top bar - notification bell (M4, MG-D13, Flow 3 and 5)", () => {
  test("a lead sees the unread count, opens the bell, and Approve asks in an AlertDialog naming the person and the effect before anything is sent", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockShell(page);
    await page.route(/\/api\/budget-reset-requests\/mine(\?|$)/, (r) =>
      r.fulfill(
        fulfil({
          ...MINE_CAN,
          eligibility: { canRequest: false, reason: "no-team" },
        }),
      ),
    );
    await mockNotifications(page, {
      items: [
        {
          id: NOTIF_ID,
          kind: "budget-reset.requested",
          createdAt: "2026-11-14T09:00:00.000Z",
          read: false,
          teamId: "team-a",
          requestId: REQUEST_ID,
          request: VIEW,
          canDecide: true,
        },
      ],
      unreadCount: 1,
    });
    const approvals: string[] = [];
    await page.route(
      /\/api\/budget-reset-requests\/[^/]+\/approve(\?|$)/,
      (r) => {
        approvals.push(r.request().url());
        return r.fulfill(
          fulfil({
            request: { ...VIEW, status: "approved" },
            resetId: "22222222-2222-4222-8222-222222222222",
            amount: 12.5,
          }),
        );
      },
    );

    await open(page, "/dashboard/me");
    const bell = page.getByRole("button", { name: "Notifications, 1 unread" });
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(page.getByText(/Budget reset requested by/)).toContainText(
      "Ada Lovelace",
    );
    await expect(page.getByText("Launch week <b>spike</b>")).toBeVisible();

    await page.getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(
      "Reset Ada Lovelace's spend in Payments to $0. They can spend again at once.",
    );
    expect(approvals).toHaveLength(0);
    await expectNoBlockingViolations(page);

    await dialog.getByRole("button", { name: /approve/i }).click();
    await expect.poll(() => approvals.length).toBe(1);
    expect(approvals[0]).toContain(
      `/api/budget-reset-requests/${REQUEST_ID}/approve`,
    );
  });

  test("the requester finds the result in the bell, with no decision buttons", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockShell(page);
    await page.route(/\/api\/budget-reset-requests\/mine(\?|$)/, (r) =>
      r.fulfill(fulfil(MINE_CAN)),
    );
    await mockNotifications(page, {
      items: [
        {
          id: NOTIF_ID,
          kind: "budget-reset.approved",
          createdAt: "2026-11-14T09:00:00.000Z",
          read: false,
          teamId: "team-a",
          requestId: REQUEST_ID,
          request: { ...VIEW, status: "approved" },
          canDecide: false,
        },
      ],
      unreadCount: 1,
    });
    await open(page, "/dashboard/me");
    await page.getByRole("button", { name: "Notifications, 1 unread" }).click();
    await expect(
      page.getByText("Your budget reset was approved"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deny" })).toHaveCount(0);
  });
});

// ---- review m4-r1 (UI blocker U-B1 and WARNs) ------------------------------------

const COUNTS = {
  teams: [{ teamId: "t1", count: 2, amount: 7.25 }],
  own: { count: 2, amount: 7.25 },
};
const COUNT_TEXT = "2 resets, $7.25";

async function mockCounts(page: Page, counts: unknown) {
  await page.route(/\/api\/budget-resets(\?|$)/, (r) =>
    r.fulfill(fulfil(counts)),
  );
}

const TEAM_DETAIL = {
  connected: true,
  spendSource: "litellm-team",
  team: {
    alias: "Payments",
    spend: 321.75,
    maxBudget: 500,
    softBudget: null,
    budgetDuration: "30d",
    models: ["claude-sonnet"],
    rpmLimit: null,
    tpmLimit: null,
  },
  daily: [],
  enabledOperations: ["resetMemberSpend", "setTeamBudget"],
};
const APP_TEAMS = [
  {
    teamId: "t1",
    teamName: "Payments",
    spendSource: "litellm-team",
    spend: 321.75,
  },
];

// The Team page and the Organisation tab read these LiteLLM routes; everything
// else answers 404 (hidden, never broken). Fixtures only (Rule 60.24).
async function mockManagement(page: Page) {
  await page.route(/\/api\/sync-status(\?|$)/, (r) =>
    r.fulfill(fulfil({ state: "never-synced" })),
  );
  await page.route(/\/api\/access\/org-units(\?|$)/, (r) =>
    r.fulfill(
      fulfil({
        teams: [{ id: "t1", name: "Payments", departmentId: "d1" }],
        departments: [{ id: "d1", name: "Engineering" }],
      }),
    ),
  );
  await page.route(/\/api\/litellm\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    const body: Record<string, unknown> = {
      "/api/litellm/me": {
        linked: false,
        enabledOperations: ["resetMemberSpend"],
        teams: [
          {
            teamId: "t1",
            teamName: "Payments",
            linked: true,
            configurable: true,
          },
        ],
      },
      "/api/litellm/teams/t1": TEAM_DETAIL,
      "/api/litellm/teams/t1/members": { connected: true, items: [] },
      "/api/litellm/teams/t1/keys": { connected: true, items: [] },
      "/api/litellm/models": { items: ["claude-sonnet"] },
      "/api/litellm/org": {
        configured: true,
        totals: { spend: 321.75 },
        enabledOperations: [],
        daily: [],
        litellmTeams: [],
        appTeams: APP_TEAMS,
      },
    };
    return path in body
      ? route.fulfill(fulfil(body[path]))
      : route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "not found" } },
        });
  });
}

test.describe("Team page Budgets view - open requests (review m4-r1 U-B1; MG-D12: a decision never depends on the bell)", () => {
  test("an open request lists its requester and reason as text; Deny asks in an AlertDialog and POSTs to /deny", async ({
    page,
    context,
  }) => {
    // internal-org-admin stands in for the Lead (the harness cannot forge a
    // team-scope Lead), as in manage-team-views.spec.ts.
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockManagement(page);
    await mockCounts(page, NO_COUNTS);
    await mockNotifications(page, { items: [], unreadCount: 0 });
    const teamView = { ...VIEW, teamId: "t1" };
    await page.route(/\/api\/budget-reset-requests(\?|$)/, (r) =>
      r.fulfill(fulfil({ items: [teamView] })),
    );
    const denials: string[] = [];
    await page.route(/\/api\/budget-reset-requests\/[^/]+\/deny(\?|$)/, (r) => {
      denials.push(new URL(r.request().url()).pathname);
      return r.fulfill(fulfil({ request: { ...teamView, status: "denied" } }));
    });

    await open(page, "/dashboard/manage/team?team=t1&view=budgets");
    const row = page.getByRole("listitem").filter({ hasText: "Ada Lovelace" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("ada@example.test");
    await expect(row.getByText("Launch week <b>spike</b>")).toBeVisible();

    await row.getByRole("button", { name: "Deny" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Ada Lovelace");
    expect(denials).toHaveLength(0);
    await expectNoBlockingViolations(page);

    await dialog.getByRole("button", { name: "Deny request" }).click();
    await expect
      .poll(() => denials)
      .toEqual([`/api/budget-reset-requests/${REQUEST_ID}/deny`]);
  });
});

test.describe("Top bar bell (review m4-r1 UI WARNs; MG-D13, Flow 5)", () => {
  const deniedList = {
    items: [
      {
        id: NOTIF_ID,
        kind: "budget-reset.denied",
        createdAt: "2026-11-14T09:00:00.000Z",
        read: false,
        teamId: "team-a",
        requestId: REQUEST_ID,
        request: { ...VIEW, status: "denied" },
        canDecide: false,
      },
    ],
    unreadCount: 1,
  };
  const setup = async (
    page: Page,
    context: Parameters<typeof signInAsTestUser>[0],
  ) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockShell(page);
    await page.route(/\/api\/budget-reset-requests\/mine(\?|$)/, (r) =>
      r.fulfill(fulfil(MINE_CAN)),
    );
    await mockNotifications(page, deniedList);
  };

  test("the requester finds 'denied' in the bell, with no decision buttons (Flow 5)", async ({
    page,
    context,
  }) => {
    await setup(page, context);
    await open(page, "/dashboard/me");
    await page.getByRole("button", { name: "Notifications, 1 unread" }).click();
    await expect(page.getByText("Your budget reset was denied")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deny" })).toHaveCount(0);
  });

  test("keyboard: Tab reaches the bell, Enter opens it, Escape closes it and focus returns to the bell (WCAG 2.1.1, 2.4.3)", async ({
    page,
    context,
  }) => {
    await setup(page, context);
    await open(page, "/dashboard/me");
    const bell = page.getByRole("button", { name: "Notifications, 1 unread" });
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      if (await bell.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(bell).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Your budget reset was denied")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Your budget reset was denied")).toHaveCount(0);
    await expect(bell).toBeFocused();
  });

  test("at 375px the open popover fits the viewport: no horizontal scroll, axe clean", async ({
    page,
    context,
  }) => {
    await setup(page, context);
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, "/dashboard/me");
    await page.getByRole("button", { name: "Notifications, 1 unread" }).click();
    await expect(page.getByText("Your budget reset was denied")).toBeVisible();
    const overflow = await page.evaluate(() => ({
      s: document.documentElement.scrollWidth,
      c: document.documentElement.clientWidth,
    }));
    expect(overflow.s).toBeLessThanOrEqual(overflow.c);
    await expectNoBlockingViolations(page);
  });
});

test.describe("Budget reset counts are visible text (review m4-r1 UI WARNs; MG-D9, MG-D10)", () => {
  test("My usage shows the person's own count", async ({ page, context }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockShell(page);
    await mockCounts(page, COUNTS);
    await mockNotifications(page, { items: [], unreadCount: 0 });
    await page.route(/\/api\/budget-reset-requests\/mine(\?|$)/, (r) =>
      r.fulfill(fulfil(MINE_CAN)),
    );
    await open(page, "/dashboard/me");
    await expect(
      page.getByText(`Your budget resets in this range: ${COUNT_TEXT}`),
    ).toBeVisible();
  });

  test("the Team page's Budgets view shows the team's count", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockManagement(page);
    await mockCounts(page, COUNTS);
    await mockNotifications(page, { items: [], unreadCount: 0 });
    await page.route(/\/api\/budget-reset-requests(\?|$)/, (r) =>
      r.fulfill(fulfil({ items: [] })),
    );
    await open(page, "/dashboard/manage/team?team=t1&view=budgets");
    await expect(
      page.getByText(`Budget resets in this range: ${COUNT_TEXT}`),
    ).toBeVisible();
  });

  test("the Organisation tab shows the team's count in its Budget resets column", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockManagement(page);
    await mockCounts(page, COUNTS);
    await mockNotifications(page, { items: [], unreadCount: 0 });
    await open(page, "/dashboard/manage/litellm/organisation");
    await expect(
      page.getByRole("columnheader", { name: "Budget resets" }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: COUNT_TEXT })).toBeVisible();
  });
});

// Design System - Layout (the top bar keeps one row; the bell needs the room):
// the Custom label is visually hidden between md and xl and shown elsewhere;
// the accessible name stays (WCAG 2.5.3 / 4.1.2). Review m4-r1 UI WARN: hidden
// at 768 and 1024, shown at 375 and 1440.
test.describe("DateRangePicker 'Custom' label by width (review m4-r1)", () => {
  const cases: Array<[number, "hidden" | "shown"]> = [
    [375, "shown"],
    [768, "hidden"],
    [1024, "hidden"],
    [1440, "shown"],
  ];
  for (const [width, state] of cases) {
    test(`at ${width}px the Custom text is ${state} and the name 'Custom date range' stays`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-viewer"] });
      await mockShell(page);
      await mockNotifications(page, { items: [], unreadCount: 0 });
      await page.route(/\/api\/budget-reset-requests\/mine(\?|$)/, (r) =>
        r.fulfill(fulfil(MINE_CAN)),
      );
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/dashboard/me");
      const trigger = page.getByRole("button", { name: "Custom date range" });
      await expect(trigger).toBeVisible();
      const box = await trigger
        .getByText("Custom", { exact: true })
        .boundingBox();
      if (!box) throw new Error("the Custom label has no layout box");
      if (state === "hidden") expect(box.width).toBeLessThanOrEqual(1);
      else expect(box.width).toBeGreaterThan(20);
    });
  }
});
