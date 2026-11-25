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
// AlertDialog in a real browser. This project's sessions carry no team-scope
// Lead (Lead scope lives in DynamoDB), so internal-org-admin stands in for the
// Lead path; the role-probe project (team-admin on team-payments) runs the
// lead's rail, 404s and reset dialog in role-landing.spec.ts. The LiteLLM API is fulfilled from fixtures (Rule 60.24).
const KEY_VALUE = "sk-E2E-SHOWN-ONCE";
const OPS = [
  "generateMemberKey",
  "setTeamBudget",
  "setTeamModels",
  "removeTeamMember",
  "resetMemberSpend",
];
const TEAM_ID = "team-payments";
const UNLINKED_TEAM_ID = "appteam-00000000-0000-4000-8000-000000000001";
const LIST_URL = "/dashboard/manage/team";
const TEAM_URL = `${LIST_URL}/${TEAM_ID}`;
// Slice B2b (Design System - Management pages, *Team page views and links*):
// the page is three views, ?view= in the URL, only the active one rendered.
const VIEW_REGIONS = {
  members: "LiteLLM members",
  budgets: "Budget and limits",
  keys: "Models",
} as const;
const VIEWS = ["members", "budgets", "keys"] as const;
const REMOVE_PATH = `/api/litellm/teams/${TEAM_ID}/members/oid-ada`;
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
              teamId: TEAM_ID,
              teamName: "Payments",
              linked: true,
              configurable: true,
            },
          ],
        });
      case `GET /api/litellm/teams/${TEAM_ID}`:
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
      case `GET /api/litellm/teams/${TEAM_ID}/members`:
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
      case `GET /api/litellm/teams/${TEAM_ID}/keys`:
        return ok({ connected: true, items: [] });
      case "GET /api/litellm/models":
        return ok({ items: ["claude-sonnet", "claude-haiku"] });
      case `DELETE ${REMOVE_PATH}`:
        return ok({ oid: "oid-ada", removed: true });
      case `POST /api/litellm/teams/${TEAM_ID}/keys`:
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
    await page.goto("/dashboard/litellm/team-config?team=team-payments");
    await waitForHydration(page);
    await expect(page).toHaveURL(/\/dashboard\/manage\/team\/team-payments$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Team management" }),
    ).toBeVisible();

    // B2b: each view holds its sections (Members opens first).
    await expect(
      page.getByRole("region", { name: "LiteLLM members" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Budgets" }).click();
    // M2 (MI-D7): the Budgets view holds only Budget and limits; the spend and
    // its budget bar moved to Team usage (e2e/team-usage.spec.ts).
    await expect(
      page.getByRole("region", { name: "Budget and limits" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Team spend", exact: true }),
    ).toHaveCount(0);
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
        await page.goto(`${TEAM_URL}?view=${view}`);
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

  // Unit TP1 (Design System - Team page, round 3, FieldHelp table, T-TP6, T-TP7):
  // the LiteLLM fields carry their help; one popover opens in the real shell
  // and the page stays axe-clean with it open, at 375px and desktop.
  for (const width of [375, 1440]) {
    test(`a field's help opens beside Max budget and Models and stays axe-clean at ${width}px (T-TP6)`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await mockApi(page);
      await page.goto(`${TEAM_URL}?view=budgets`);
      await waitForHydration(page);
      await page.getByRole("button", { name: "About Max budget" }).click();
      await expect(
        page.getByText(
          "The most this LiteLLM team may spend in one budget period. LiteLLM refuses requests above it.",
        ),
      ).toBeVisible();
      await expectNoBlockingViolations(page, "Max budget help open");
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "About Max budget" }),
      ).toBeFocused();

      await page.goto(`${TEAM_URL}?view=keys`);
      await waitForHydration(page);
      await page.getByRole("button", { name: "About Models" }).click();
      await expect(
        page.getByText("The models this LiteLLM team may call."),
      ).toBeVisible();
      await expectNoBlockingViolations(page, "Models help open");
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
    await page.route(
      new RegExp(`/api/litellm/teams/${TEAM_ID}(\\?|$)`),
      (route) =>
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
    await page.goto(`${TEAM_URL}?view=budgets`);
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

    test("Confirm sends DELETE /api/litellm/teams/<team>/members/<oid>", async ({
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
    // Design System - Reset any LiteLLM user, Dialog text (D-RS9).
    await expect(dialog).toContainText(
      "Sets Ada Lovelace's spend to $0.00. Usage history, cost data and the audit log do not change.",
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
    const response = await page.goto(LIST_URL);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Team management" }),
    ).toBeVisible();
    const team = await page.goto(TEAM_URL);
    expect(team?.status()).toBe(200);
    await expect(
      page.getByRole("region", { name: "LiteLLM members" }),
    ).toBeVisible();
  });
});

// App Teams spec (docs/specs/2026-11-17-app-teams.md) - Spend source, UI. One
// linked team (team-payments: the LiteLLM team figure, plus the member sum an org-admin
// gets on request) and one unlinked team (the created Platform Guild team: the member sum, no LiteLLM
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
          teamId: TEAM_ID,
          teamName: "Payments",
          linked: true,
          configurable: true,
        },
        {
          teamId: UNLINKED_TEAM_ID,
          teamName: "Risk",
          linked: false,
          configurable: true,
        },
      ],
    }),
  );
  await page.route(
    new RegExp(`/api/litellm/teams/${TEAM_ID}(\\?|$)`),
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
    new RegExp(`/api/litellm/teams/${UNLINKED_TEAM_ID}(\\?|$)`),
    respond({
      connected: false,
      spendSource: "member-sum",
      daily: MEMBER_SUM.daily,
      memberSum: MEMBER_SUM,
    }),
  );
}

test.describe("Management -> Team: spend source (App Teams)", () => {
  test("a linked team's Budgets view has no spend panel and no member-sum request; the spend moved to Team usage (MI-D7)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockSpendSources(page);
    const asked: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.searchParams.get("include") === "memberSum") asked.push(url.href);
    });
    await page.goto(`${TEAM_URL}?view=budgets`);
    await waitForHydration(page);
    await expect(
      page.getByRole("region", { name: "Budget and limits" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Team spend", exact: true }),
    ).toHaveCount(0);
    expect(asked).toEqual([]);
    await expect(page.getByRole("tab", { name: "Keys" })).toBeVisible();
  });

  test("an unlinked team shows the no-LiteLLM-team note, no spend panel and no LiteLLM control (MI-D7)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockSpendSources(page);
    await page.goto(`${LIST_URL}/${UNLINKED_TEAM_ID}`);
    await waitForHydration(page);
    await expect(
      page.getByRole("region", { name: "Team spend", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "This team has no LiteLLM team of its own. Budgets, limits and keys are managed in LiteLLM.",
      ),
    ).toBeVisible();
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
    // L4b review round 1: axe on the unlinked page.
    await expectNoBlockingViolations(page);
  });
});

// Unit TM1 (Design System - Management pages, "List, then the team", D-TM1 to
// D-TM4; Access Control - Enforcement item 2, TM1 sentence).
// The ids are the default seed's: team-payments (registry team, Engineering)
// and the created Platform Guild team. A team-scope or department-scope Lead
// cannot be forged in this project (Lead scope lives in DynamoDB), so the
// lead journeys - a lead's list rows and click-through, a department lead's
// teams, a lead opening another team's URL - run in the `role-probe` project
// (role-landing.spec.ts). Role and scope logic is covered by the page tests.
test.describe("Management -> Team: list, then the team (unit TM1)", () => {
  test("the list shows the seeded teams with department, members and linked LiteLLM team; a row's name opens that team's page (D-TM1)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await page.goto(LIST_URL);
    await waitForHydration(page);
    const table = page.getByRole("table");
    for (const name of ["Team", "Department", "Members", "LiteLLM team"]) {
      await expect(
        table.getByRole("columnheader", { name, exact: true }),
        name,
      ).toBeVisible();
    }
    await expect(
      table.getByRole("row", { name: /Platform Guild/ }),
    ).toBeVisible();
    await table.getByRole("link", { name: "Payments", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${TEAM_URL}$`));
    await expect(
      page.getByRole("region", { name: "LiteLLM members" }),
    ).toBeVisible();
  });

  // Design System - "Sorting in the other tables (unit SRT1, 2026-11-24;
  // D-SR1)": the team list sorts in the browser with the one SortableHeader;
  // the sort lives in the URL, so a real reload keeps it.
  test("a header click sorts the team list, writes sort and dir to the URL and a reload keeps it (unit SRT1; D-SR1)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await page.goto(LIST_URL);
    await waitForHydration(page);
    const members = page.getByRole("columnheader", {
      name: "Members",
      exact: true,
    });
    await expect(members).toHaveAttribute("aria-sort", "none");
    await members.getByRole("button").click();
    await expect(page).toHaveURL(/sort=members/);
    await expect(members).toHaveAttribute("aria-sort", "ascending");
    await members.getByRole("button").click();
    await expect(members).toHaveAttribute("aria-sort", "descending");
    await expect(page).toHaveURL(/dir=desc/);
    await page.reload();
    await waitForHydration(page);
    await expect(
      page.getByRole("columnheader", { name: "Members", exact: true }),
    ).toHaveAttribute("aria-sort", "descending");
  });

  test("the team page has no team picker and no scope dropdowns (D-TM2)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await page.goto(TEAM_URL);
    await waitForHydration(page);
    await expect(
      page.getByRole("region", { name: "LiteLLM members" }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Team", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel(/Team admins.*scope/i)).toHaveCount(0);
    await expect(page.getByLabel(/Visibility scope/i)).toHaveCount(0);
  });

  test("New team is on the list page, not the team page (D-TM4)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await page.goto(LIST_URL);
    await waitForHydration(page);
    await expect(page.getByRole("button", { name: "New team" })).toBeVisible();
    await page.goto(TEAM_URL);
    await waitForHydration(page);
    await expect(page.getByRole("button", { name: "New team" })).toHaveCount(0);
  });

  test("?team=<id> lands on /dashboard/manage/team/<id>, keeping ?view= (TM1 agent decision)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await page.goto(`${LIST_URL}?team=${TEAM_ID}&view=budgets`);
    await waitForHydration(page);
    await expect(page).toHaveURL(new RegExp(`${TEAM_URL}\\?view=budgets$`));
    await expect(
      page.getByRole("region", { name: "Budget and limits" }),
    ).toBeVisible();
  });

  test("an unknown team id is the standard 404, the same page as an out-of-scope team (Access Control - Enforcement)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    const response = await page.goto(`${LIST_URL}/no-such-team`);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("region", { name: "LiteLLM members" }),
    ).toHaveCount(0);
  });

  test("a Viewer gets the standard 404 on the list and on a team page (hidden means absent)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page);
    expect((await page.goto(LIST_URL))?.status()).toBe(404);
    expect((await page.goto(TEAM_URL))?.status()).toBe(404);
  });

  test("the list has no serious or critical axe violations", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await page.goto(LIST_URL);
    await waitForHydration(page);
    await expect(page.getByRole("table")).toBeVisible();
    await expectNoBlockingViolations(page, "axe on the team list");
  });
});
