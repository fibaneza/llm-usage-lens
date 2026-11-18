import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System -- Management pages (Team: one page for a team's usage
// and its management; Confirm destructive actions: the AlertDialog names the
// person and the effect, Cancel focused first; Budget as a bar), Navigation
// (Sidebar) (the retired `/dashboard/litellm/team-config` redirects to
// Management -> Team); LiteLLM spec -- "Team configuration page (L4)" (Lead,
// org-admin and Admin; shown-once key dialog), LD25; Access Control --
// Navigation and landing by role (a Viewer gets the standard 404; the Auditor
// reads Team); slice B2 brief B2-3, B2-4, B2-6. Component behaviour lives in
// TeamPageContent.test.tsx and MembersPanel.test.tsx (Rule 60.24a); this
// covers the real shell, the redirect, the server gate, axe, and the
// AlertDialog in a real browser. The harness cannot forge a team-scope Lead
// (Lead scope lives in DynamoDB), so internal-org-admin stands in for the Lead
// path; the lead's rail and 404s run in role-landing.spec.ts against the probe
// identities. The LiteLLM API is fulfilled from fixtures (Rule 60.24).
const KEY_VALUE = "sk-E2E-SHOWN-ONCE";
const OPS = [
  "generateMemberKey",
  "setTeamBudget",
  "setTeamModels",
  "removeTeamMember",
  "resetMemberSpend",
];
const TEAM_URL = "/dashboard/manage/team?team=t1";
// Slice B2b (Design System - Management pages, *Team page views and links*):
// the page is three views, ?view= in the URL, only the active one rendered.
const VIEW_REGIONS = {
  members: "LiteLLM members",
  budgets: "Team spend & budgets",
  keys: "Models",
} as const;
const VIEWS = ["members", "budgets", "keys"] as const;
const REMOVE_PATH = "/api/litellm/teams/t1/members/oid-ada";
// Team is a rail item (NAV_ITEMS), so accessibility.spec.ts and smoke.spec.ts
// reach it at one width as the default auditor; this spec adds the four
// breakpoints with the write controls rendered (an admin).
const BREAKPOINTS = [375, 768, 1024, 1440] as const;

// Project standard (accessibility.spec.ts): WCAG 2 A/AA, serious or critical.
async function expectNoBlockingViolations(page: Page, label?: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target.join(" ")),
      })),
    label,
  ).toEqual([]);
}

// The budget-period spend (team_info.spend) covers at least the daily range
// (LiteLLM spec LD36), so the fixture's daily rows sum to the same figure
// instead of an empty range reading $0.00 beside "Spent this budget period".
const DAILY = [
  { date: "2026-11-14", spend: 200.25 },
  { date: "2026-11-15", spend: 121.5 },
];

async function mockApi(page: Page) {
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/litellm\//, (route) => {
    const url = new URL(route.request().url());
    const key = `${route.request().method()} ${url.pathname}`;
    const ok = (data: unknown, status = 200) =>
      route.fulfill({ status, json: { data } });
    switch (key) {
      case "GET /api/litellm/me":
        return ok({
          linked: false,
          enabledOperations: OPS,
          teams: [
            {
              teamId: "t1",
              teamName: "Payments",
              linked: true,
              configurable: true,
            },
          ],
        });
      case "GET /api/litellm/teams/t1":
        return ok({
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
          daily: DAILY,
          enabledOperations: OPS,
        });
      case "GET /api/litellm/teams/t1/members":
        return ok({
          connected: true,
          items: [
            {
              userId: "u-ada",
              oid: "oid-ada",
              name: "Ada Lovelace",
              email: "ada@example.test",
              spend: 77.1,
              maxBudget: 150,
              rpmLimit: null,
              tpmLimit: null,
            },
          ],
        });
      case "GET /api/litellm/teams/t1/keys":
        return ok({ connected: true, items: [] });
      case "GET /api/litellm/models":
        return ok({ items: ["claude-sonnet", "claude-haiku"] });
      case `DELETE ${REMOVE_PATH}`:
        return ok({ oid: "oid-ada", removed: true });
      case "POST /api/litellm/teams/t1/keys":
        return ok({ tokenId: "tok-new", key: KEY_VALUE, oid: "oid-ada" }, 201);
      default:
        return route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "not found" } },
        });
    }
  });
}

test.describe("Management -> Team page", () => {
  test("the old team-config URL redirects to the Team page, which holds the sections and generates a key shown once", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await page.goto("/dashboard/litellm/team-config?team=t1");
    await waitForHydration(page);
    await expect(page).toHaveURL(/\/dashboard\/manage\/team\?team=t1/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Team management" }),
    ).toBeVisible();

    // B2b: each view holds its sections (Members opens first).
    await expect(
      page.getByRole("region", { name: "LiteLLM members" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Budgets" }).click();
    for (const name of ["Team spend & budgets", "Budget and limits"]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    // Budget as a bar: the team budget carries a bar with text.
    await expect(
      page
        .getByRole("region", { name: "Team spend & budgets" })
        .getByRole("progressbar"),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Keys" }).click();
    for (const name of ["Keys", "Models"]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }

    await page.getByRole("button", { name: "Generate key" }).click();
    const form = page.getByRole("dialog");
    await form
      .getByRole("combobox", { name: "Key owner" })
      .selectOption("oid-ada");
    await form.getByRole("button", { name: "Generate" }).click();

    const shown = page.getByRole("dialog", { name: /key generated/i });
    await expect(shown).toContainText(KEY_VALUE);
    await expect(shown).toContainText(/you will not see this again/i);
    await shown.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText(KEY_VALUE)).toHaveCount(0);
  });

  // Review blocker U2: the page escapes the nav-driven gates, so it carries its
  // own axe (project standard: WCAG 2 A/AA, serious or critical) and the
  // no-horizontal-scroll check (Rule 40.6 breakpoints; responsive.spec.ts).
  for (const width of BREAKPOINTS) {
    test(`has no serious or critical axe violations and no horizontal scroll at ${width}px (Rule 40.6; accessibility.spec.ts)`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await mockApi(page);
      // B2b: each of the three views is checked (Design System - Management
      // pages, Team page views and links).
      for (const view of VIEWS) {
        await page.goto(`${TEAM_URL}&view=${view}`);
        await waitForHydration(page);
        await expect(
          page.getByRole("region", { name: VIEW_REGIONS[view] }),
        ).toBeVisible();

        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          overflow.scrollWidth,
          `Team page (${view}) overflows horizontally at ${width}px`,
        ).toBeLessThanOrEqual(overflow.clientWidth);

        await expectNoBlockingViolations(page, `axe on the ${view} view`);
      }
    });
  }

  // C1 item 5 (review of unit L5b; Rule 40.6 breakpoints, Design System -
  // Layout, Key-value lists): the "Current rate limits" value wraps inside its
  // Budget and limits panel at 375px instead of running past the panel edge.
  test("the Current rate limits value stays inside its Budget and limits panel at 375px (C1 item 5; Rule 40.6)", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await page.route(/\/api\/litellm\/teams\/t1(\?|$)/, (route) =>
      route.fulfill({
        json: {
          data: {
            connected: true,
            spendSource: "litellm-team",
            team: {
              alias: "Payments",
              spend: 321.75,
              maxBudget: 500,
              softBudget: null,
              budgetDuration: "30d",
              models: ["claude-sonnet"],
              rpmLimit: 1000000,
              tpmLimit: 2000000000,
            },
            daily: DAILY,
            enabledOperations: OPS,
          },
        },
      }),
    );
    await page.goto(`${TEAM_URL}&view=budgets`);
    await waitForHydration(page);
    const panel = page.getByRole("region", { name: "Budget and limits" });
    const value = panel
      .locator("dt", { hasText: "Current rate limits" })
      .locator("xpath=following-sibling::dd[1]");
    await expect(value).toContainText("req/min");
    const panelBox = await panel.boundingBox();
    const valueBox = await value.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(valueBox).not.toBeNull();
    if (!panelBox || !valueBox) return;
    expect(valueBox.x).toBeGreaterThanOrEqual(panelBox.x);
    expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(
      panelBox.x + panelBox.width + 0.5,
    );
    // The text itself does not spill out of its own box either.
    const spill = await value.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(spill).toBeLessThanOrEqual(0);
  });

  // Review blocker U1 + B2-6: the AlertDialog confirm in a real browser (Design
  // System: AlertDialog confirms destructive actions, names the person and the
  // effect, Cancel focused first; Radix focus handling).
  test.describe("remove member confirmation", () => {
    const open = async (
      page: Page,
      context: Parameters<typeof signInAsTestUser>[0],
    ) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await mockApi(page);
      const deletes: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "DELETE") deletes.push(request.url());
      });
      await page.goto(TEAM_URL);
      await waitForHydration(page);
      const trigger = page.getByRole("button", {
        name: "Remove Ada Lovelace",
      });
      await trigger.click();
      const dialog = page.getByRole("alertdialog", {
        name: "Remove Ada Lovelace?",
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(
        "Removes Ada Lovelace from Payments. Recorded in the audit log.",
      );
      await expect(
        dialog.getByRole("button", { name: "Cancel" }),
      ).toBeFocused();
      return { trigger, dialog, deletes };
    };

    test("Escape closes it, sends no DELETE and returns focus to the trigger", async ({
      page,
      context,
    }) => {
      const { trigger, dialog, deletes } = await open(page, context);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(deletes).toEqual([]);
    });

    test("Cancel closes it, sends no DELETE and returns focus to the trigger", async ({
      page,
      context,
    }) => {
      const { trigger, dialog, deletes } = await open(page, context);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(deletes).toEqual([]);
    });

    test("Confirm sends DELETE /api/litellm/teams/t1/members/<oid>", async ({
      page,
      context,
    }) => {
      const { dialog, deletes } = await open(page, context);
      const sent = page.waitForRequest(
        (request) =>
          request.method() === "DELETE" &&
          new URL(request.url()).pathname === REMOVE_PATH,
      );
      await dialog.getByRole("button", { name: "Confirm" }).click();
      await sent;
      await expect(dialog).toBeHidden();
      expect(deletes).toHaveLength(1);
    });
  });

  test("Reset spend names the person and the effect, with Cancel focused first and no request before Confirm (Confirm destructive actions)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });
    await page.goto(TEAM_URL);
    await waitForHydration(page);
    await page
      .getByRole("button", { name: "Reset spend for Ada Lovelace" })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(
      "Sets Ada Lovelace's spend to $0.00. Recorded in the audit log.",
    );
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(posts).toEqual([]);
  });

  test("the bulk reset dialog states the member count", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await page.goto(TEAM_URL);
    await waitForHydration(page);
    await page
      .getByRole("button", { name: "Reset spend for all members" })
      .click();
    const dialog = page.getByRole("alertdialog");
    // Pluralised: one member reads "1 member" (B2 review, Group overage copy).
    await expect(dialog).toContainText(
      "Resets spend for 1 member to $0.00. Recorded in the audit log.",
    );
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  });

  // Access Control - Navigation and landing by role: a Viewer gets the
  // standard 404; the Auditor now reads the page (read-only).
  test("internal-viewer gets the standard 404 on the Team URL", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page);
    const response = await page.goto(TEAM_URL);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("button", { name: "Generate key" }),
    ).toHaveCount(0);
  });

  test("internal-auditor opens the Team page", async ({ page, context }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page);
    const response = await page.goto(TEAM_URL);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Team management" }),
    ).toBeVisible();
  });
});

// App Teams spec (docs/specs/2026-11-17-app-teams.md) - Spend source, UI. One
// linked team (t1: the LiteLLM team figure, plus the member sum an org-admin
// gets on request) and one unlinked team (t2: the member sum, no LiteLLM
// control). Component cases live in TeamPageContent.test.tsx (Rule 60.24a);
// this reads both in the real shell. The LiteLLM API is fulfilled from
// fixtures (Rule 60.24).
const MEMBER_SUM = {
  total: 4,
  daily: [{ date: "2026-11-02", spend: 4 }],
  coverage: { members: 4, matched: 3, unmatched: 1, pending: 1 },
  members: [
    { oid: "oid-u1", name: "Una One", matched: true, spend: 3.5 },
    { oid: "oid-u2", name: "Dos Two", matched: true, spend: 0.5 },
    { oid: "oid-u3", name: "Tres Three", matched: false },
    // Matched, spend withheld by the Organisation cap (AT3): "Hidden until per-user
    // reporting is approved" (coordinator ruling 2026-11-17, the Users page wording).
    { oid: "oid-u4", name: "Cuatro Four", matched: true },
  ],
};

async function mockSpendSources(page: Page) {
  await mockApi(page);
  const respond = (data: unknown) => (route: Route) =>
    route.fulfill({ status: 200, json: { data } });
  await page.route(
    /\/api\/litellm\/me(\?|$)/,
    respond({
      linked: false,
      enabledOperations: OPS,
      teams: [
        {
          teamId: "t1",
          teamName: "Payments",
          linked: true,
          configurable: true,
        },
        { teamId: "t2", teamName: "Risk", linked: false, configurable: true },
      ],
    }),
  );
  await page.route(
    /\/api\/litellm\/teams\/t1(\?|$)/,
    respond({
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
      daily: DAILY,
      memberSum: { ...MEMBER_SUM, total: 250, daily: [] },
      enabledOperations: OPS,
    }),
  );
  await page.route(
    /\/api\/litellm\/teams\/t2(\?|$)/,
    respond({
      connected: false,
      spendSource: "member-sum",
      daily: MEMBER_SUM.daily,
      memberSum: MEMBER_SUM,
    }),
  );
}

test.describe("Management -> Team: spend source (App Teams)", () => {
  test("a linked team shows the LiteLLM team figure, and an org-admin also the member sum with why they differ", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockSpendSources(page);
    const asked = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/litellm/teams/t1" &&
        new URL(request.url()).searchParams.get("include") === "memberSum",
    );
    await page.goto("/dashboard/manage/team?team=t1&view=budgets");
    await waitForHydration(page);
    await asked;
    const spend = page.getByRole("region", { name: "Team spend & budgets" });
    await expect(spend).toContainText("$321.75");
    await expect(spend).toContainText("LiteLLM team");
    await expect(spend).toContainText("Sum of members");
    await expect(spend).toContainText("$250.00");
    await expect(spend).toContainText(
      "each app member spent through the gateway",
    );
    await expect(page.getByRole("tab", { name: "Keys" })).toBeVisible();
  });

  test("an unlinked team shows the member sum with coverage and 'not in LiteLLM', and no LiteLLM control", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockSpendSources(page);
    await page.goto("/dashboard/manage/team?team=t2");
    await waitForHydration(page);
    const spend = page.getByRole("region", { name: "Team spend", exact: true });
    await expect(spend).toContainText("$4.00");
    await expect(spend).toContainText("Sum of members");
    await expect(spend).toContainText("3 matched");
    await expect(spend.getByRole("row", { name: /Tres Three/ })).toContainText(
      "not in LiteLLM",
    );
    await expect(
      page.getByText(
        "This team has no LiteLLM team of its own. Budgets, limits and keys are managed in LiteLLM.",
      ),
    ).toBeVisible();
    await expect(spend.getByRole("row", { name: /Cuatro Four/ })).toContainText(
      "Hidden until per-user reporting is approved",
    );
    // B2b (Unlinked rule): only the Members view, so no Budgets or Keys tab.
    await expect(page.getByRole("tab", { name: "Budgets" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Keys" })).toHaveCount(0);
    // AT4: no LiteLLM panel renders for an unlinked team.
    for (const name of [
      "LiteLLM members",
      "Keys",
      "Budget and limits",
      "Models",
    ]) {
      await expect(page.getByRole("region", { name }), name).toHaveCount(0);
    }
    await expect(
      page.getByRole("button", { name: "Generate key" }),
    ).toHaveCount(0);
    // L4b review round 1: axe on the populated Team spend panel.
    await expectNoBlockingViolations(page);
  });
});
