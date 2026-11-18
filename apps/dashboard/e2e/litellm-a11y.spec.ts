import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// L5b: the accessibility floor and responsive checks of the LiteLLM views on
// the Management routes and My usage. Sources: LiteLLM spec -- "Polish and
// verification (L5)" (Accessibility floor, Responsive, L5b scope); Design
// System -- Management pages (Team: selector, view tabs, member search;
// Audit: source filter; Confirm destructive actions; Budget as a bar),
// Responsive Tables, Animation (reduced-motion floor); Rule 40.6; Rule 60.24a.
// Existing coverage is not repeated: axe + no-scroll at 375/768/1024/1440 for an
// admin on every page (accessibility.spec.ts "slice B2 surfaces"), the remove
// member dialog (manage-team.spec.ts), role gating and redirects
// (manage-pages.spec.ts). This file covers the gaps: axe per other role and in
// the dialog states, the keyboard walk, text-not-colour states, cards below md
// and the 1920 width, and reduced motion.
//
// The harness cannot forge a team-scope Lead (Lead scope lives in DynamoDB,
// see manage-team.spec.ts), so internal-org-admin stands in for the Lead on
// the Team page, where it holds the same lower-only controls (LD26). The LiteLLM
// API is fulfilled from fixtures (Rule 60.24).

const ADMIN_OPS = [
  "addTeamMember",
  "removeTeamMember",
  "resetMemberSpend",
  "resetMemberBudget",
  "setMemberBudget",
  "setMemberLimits",
  "disableMember",
  "enableMember",
  "generateMemberKey",
  "updateMemberKey",
  "blockKey",
  "unblockKey",
  "rotateKey",
  "deleteKey",
  "setTeamBudget",
  "setTeamLimits",
  "setTeamModels",
] as const;

const TEAM_URL = "/dashboard/manage/team?team=t1";
// Slice B2b (Design System -- Management pages, *Team page views and links*):
// the Team page is three views on ?view= (default members); only the active
// view is rendered, so a test opens the view that holds what it uses.
type TeamView = "members" | "budgets" | "keys";
const TEAM_VIEWS: readonly TeamView[] = ["members", "budgets", "keys"];
const teamUrl = (view: TeamView) => `${TEAM_URL}&view=${view}`;
const KEY_VALUE = "sk-L5B-SHOWN-ONCE";

type MockOptions = {
  unlinkedTeam?: boolean;
  ops?: readonly string[];
  teams?: readonly {
    teamId: string;
    teamName: string;
    linked: boolean;
    configurable?: boolean;
  }[];
  // Pathnames answered 503 LITELLM_UNAVAILABLE.
  unavailable?: readonly string[];
  // The Organisation cap in force: per-user cost omitted (LD23, LD27).
  capped?: boolean;
  members?: readonly Record<string, unknown>[];
  keys?: readonly Record<string, unknown>[];
};

const TEAMS = [
  { teamId: "t1", teamName: "Payments", linked: true, configurable: true },
  { teamId: "t2", teamName: "Platform", linked: true, configurable: true },
] as const;

const MEMBERS = [
  {
    userId: "u-ada",
    oid: "oid-ada",
    name: "Ada Lovelace",
    email: "ada@example.test",
    spend: 160,
    maxBudget: 150,
    rpmLimit: null,
    tpmLimit: null,
  },
  {
    userId: "u-grace",
    oid: "oid-grace",
    name: "Grace Hopper",
    email: "grace@example.test",
    spend: 30,
    maxBudget: null,
    rpmLimit: null,
    tpmLimit: null,
  },
] as const;

const KEYS = [
  {
    tokenId: "tok-1234",
    keyAlias: "ci-key",
    blocked: false,
    expires: null,
    models: ["claude-sonnet"],
    spend: 12.5,
    maxBudget: 50,
  },
  {
    tokenId: "tok-5678",
    keyAlias: "old-key",
    blocked: true,
    expires: null,
    models: ["claude-haiku"],
    spend: 3,
    maxBudget: null,
  },
] as const;

async function mockApi(page: Page, options: MockOptions = {}) {
  const ops = options.ops ?? ADMIN_OPS;
  const teams = options.teams ?? TEAMS;
  const capped = options.capped ?? false;
  const unavailable = new Set(options.unavailable ?? []);
  const keys = options.keys ?? KEYS;
  const members = (options.members ?? MEMBERS).map((member) => {
    if (!capped) return member;
    return Object.fromEntries(
      Object.entries(member).filter(
        ([field]) => field !== "spend" && field !== "maxBudget",
      ),
    );
  });
  const daily = [{ date: "2026-11-14", spend: 4.5 }];

  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/litellm\//, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const ok = (data: unknown, status = 200) =>
      route.fulfill({ status, json: { data } });
    if (unavailable.has(path)) {
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "LITELLM_UNAVAILABLE",
            message: "LiteLLM unavailable",
          },
        },
      });
    }
    const team = /^\/api\/litellm\/teams\/(t\d)(\/[a-z-]+)?$/.exec(path);
    if (team && request.method() === "GET") {
      const [, id, sub] = team;
      if (sub === "/members") {
        return ok({
          connected: true,
          items: members,
          candidates: [
            { oid: "oid-new", name: "Alan Turing", email: "alan@example.test" },
          ],
        });
      }
      if (sub === "/keys") return ok({ connected: true, items: keys });
      if (sub === undefined && options.unlinkedTeam) {
        return ok({
          connected: false,
          spendSource: "member-sum",
          daily,
          memberSum: {
            total: 4,
            daily,
            coverage: { members: 2, matched: 1, unmatched: 1, pending: 0 },
            members: [
              { oid: "oid-ada", name: "Ada Lovelace", matched: true, spend: 4 },
              { oid: "oid-bob", name: "Bob Byte", matched: false },
            ],
          },
        });
      }
      if (sub === undefined) {
        return ok({
          connected: true,
          spendSource: "litellm-team",
          team: {
            alias: id === "t1" ? "Payments" : "Platform",
            spend: id === "t1" ? 321.75 : 10,
            maxBudget: 500,
            softBudget: null,
            budgetDuration: "30d",
            models: ["claude-sonnet"],
            rpmLimit: null,
            tpmLimit: null,
          },
          daily,
          enabledOperations: ops,
        });
      }
    }
    if (path === "/api/litellm/teams/t1/keys" && request.method() === "POST") {
      return ok({ tokenId: "tok-new", key: KEY_VALUE, oid: "oid-ada" }, 201);
    }
    if (
      path === "/api/litellm/teams/t1/keys/tok-1234/rotate" &&
      request.method() === "POST"
    ) {
      return ok({
        tokenId: "tok-rotated",
        previousTokenId: "tok-1234",
        key: KEY_VALUE,
      });
    }
    switch (`${request.method()} ${path}`) {
      case "GET /api/litellm/me":
        return ok({
          linked: true,
          spend: 12.5,
          maxBudget: 100,
          daily,
          keys,
          teams,
          enabledOperations: ops,
        });
      case "GET /api/litellm/models":
        return ok({ items: ["claude-sonnet", "claude-haiku"] });
      case "GET /api/litellm/org":
        return ok({
          configured: true,
          totals: { spend: 1234.5 },
          enabledOperations: [],
          daily,
          litellmTeams: [
            {
              litellmTeamId: "ll-1",
              alias: "Payments LLM",
              spend: 321.75,
              maxBudget: 500,
              memberCount: 7,
              linkedAppTeam: { teamId: "t1", teamName: "Payments" },
            },
          ],
          appTeams: [
            {
              teamId: "t1",
              teamName: "Payments",
              spendSource: "litellm-team",
              spend: 321.75,
            },
          ],
        });
      case "GET /api/litellm/users":
        return ok({
          page: 1,
          pageSize: 25,
          enabledOperations: [],
          users: [
            {
              userId: "u-ada",
              email: "ada@example.test",
              ...(capped ? {} : { spend: 77.1, maxBudget: 150 }),
              teams: [{ teamId: "t1", teamName: "Payments" }],
            },
          ],
        });
      case "GET /api/litellm/users/u-ada":
        return ok({
          userId: "u-ada",
          email: "ada@example.test",
          ...(capped ? {} : { spend: 77.1, maxBudget: 150 }),
          daily,
          enabledOperations: [],
        });
      case "GET /api/litellm/audit":
        return ok({
          items: [
            {
              id: "a1",
              updatedAt: "2026-11-15T13:00:00Z",
              changedBy: "ops@example.test",
              action: "update",
              tableName: "LiteLLM_TeamTable",
              objectId: "t1",
              changedFields: ["max_budget"],
              viaDashboard: false,
            },
          ],
        });
      default:
        return route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "not found" } },
        });
    }
  });
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await waitForHydration(page);
}

// Project standard (accessibility.spec.ts): WCAG 2 A/AA, serious or critical.
async function expectNoBlockingViolations(page: Page) {
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
  ).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${label} overflows horizontally`,
  ).toBeLessThanOrEqual(overflow.clientWidth);
}

// The page frame below the top bar (as fluid-workspace.spec.ts selects it).
const pageBody = (page: Page) =>
  page.locator('[data-slot="sidebar-inset"] > header + *');

async function teamPageReady(page: Page, view: TeamView = "members") {
  await expect(
    page.getByRole("heading", { level: 1, name: "Team management" }),
  ).toBeVisible();
  if (view === "members") {
    await expect(
      page.getByRole("region", { name: "LiteLLM members" }),
    ).toContainText("Ada Lovelace");
  } else if (view === "budgets") {
    await expect(
      page.getByRole("region", { name: "Budget and limits" }),
    ).toBeVisible();
  } else {
    await expect(page.getByRole("region", { name: "Keys" })).toContainText(
      "ci-key",
    );
    await expect(page.getByRole("region", { name: "Models" })).toBeVisible();
  }
}

async function focusIsInside(dialog: Locator) {
  await expect
    .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true);
}

// Open with the keyboard, focus lands inside, Escape closes, focus returns to
// the trigger (L5 Accessibility floor: "each dialog opening with focus inside,
// closing with Escape and returning focus to its trigger").
async function walkDialog(
  page: Page,
  trigger: Locator,
  role: "dialog" | "alertdialog",
) {
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole(role);
  await expect(dialog).toBeVisible();
  await focusIsInside(dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}

// ---------------------------------------------------------------------------
// 1. axe per role (Accessibility floor: "axe ... on each page for Admin, a Lead
// and a Viewer"). Admin on every page at the four widths is already covered.
// ---------------------------------------------------------------------------
test.describe("axe per role and dialog state (L5 Accessibility floor)", () => {
  const LEAD_PAGES: readonly [string, string][] = [
    [TEAM_URL, "Team"],
    ["/dashboard/manage/litellm/organisation", "Organisation"],
    ["/dashboard/me", "My usage"],
  ];

  for (const [path, label] of LEAD_PAGES) {
    test(`org admin (Lead stand-in): ${label} with data is axe-clean`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-org-admin"] });
      await mockApi(page);
      await open(page, path);
      if (path === TEAM_URL) await teamPageReady(page);
      else {
        await expect(
          page.getByRole("table", {
            name: label === "Organisation" ? "LiteLLM teams" : "Your keys",
          }),
        ).toBeVisible();
      }
      await expectNoBlockingViolations(page);
    });
  }

  for (const view of TEAM_VIEWS) {
    test(`admin: the Team ${view} view with data is axe-clean (B2b view tabs)`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await mockApi(page);
      await open(page, teamUrl(view));
      await teamPageReady(page, view);
      await expectNoBlockingViolations(page);
    });
  }

  test("org admin: Users with search results is axe-clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await open(page, "/dashboard/manage/users");
    await page.getByRole("searchbox", { name: /search users/i }).fill("ada");
    await expect(
      page.getByRole("button", { name: "ada@example.test" }),
    ).toBeVisible();
    await expectNoBlockingViolations(page);
  });

  test("viewer: the standard 404 page is axe-clean (Access Control: Hidden means absent)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page, { teams: [] });
    const response = await page.goto("/dashboard/manage/team");
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/this page could not be found/i)).toBeVisible();
    await expectNoBlockingViolations(page);
  });

  test("viewer: My usage with the LiteLLM view loaded is axe-clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page, { teams: [], ops: [] });
    await open(page, "/dashboard/me");
    await expect(page.getByRole("table", { name: "Your keys" })).toBeVisible();
    await expectNoBlockingViolations(page);
  });

  test("auditor: Team is read-only (no write controls) and axe-clean (Design System: Team; Auditor reads)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page, { ops: [] });
    // B2b: the auditor reads all three views, none with a write control.
    for (const view of TEAM_VIEWS) {
      await open(page, teamUrl(view));
      await teamPageReady(page, view);
      for (const name of [
        "Generate key",
        "Add member",
        "Reset spend for all members",
        "Save budget",
      ]) {
        await expect(page.getByRole("button", { name })).toHaveCount(0);
      }
      await expectNoBlockingViolations(page);
    }
    await expect(page.getByRole("tab")).toHaveText([
      "Members",
      "Budgets",
      "Keys",
    ]);
  });

  test("auditor: Audit is axe-clean on the default source and on the Gateway source with data", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page);
    await open(page, "/dashboard/manage/audit");
    await expect(
      page.getByRole("heading", { level: 1, name: "Audit log" }),
    ).toBeVisible();
    await expectNoBlockingViolations(page);

    await page.getByRole("button", { name: "Gateway" }).click();
    await expect(
      page.getByRole("table", { name: "LiteLLM audit entries" }),
    ).toBeVisible();
    await expectNoBlockingViolations(page);
  });

  test("admin: Team with a form dialog open is axe-clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, TEAM_URL);
    await teamPageReady(page);
    await page
      .getByRole("region", { name: "LiteLLM members" })
      .getByRole("button", { name: "Add member" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Add member" }),
    ).toBeVisible();
    await expectNoBlockingViolations(page);
  });

  test("admin: Team with a confirm (alert) dialog open is axe-clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, TEAM_URL);
    await teamPageReady(page);
    await page
      .getByRole("button", { name: "Reset spend for all members" })
      .click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expectNoBlockingViolations(page);
  });

  test("admin: the shown-once key dialog is axe-clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, teamUrl("keys"));
    await teamPageReady(page, "keys");
    await page.getByRole("button", { name: "Generate key" }).click();
    await page
      .getByRole("combobox", { name: "Key owner" })
      .selectOption("oid-ada");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: /key generated/i }),
    ).toBeVisible();
    await expectNoBlockingViolations(page);
  });
});

// ---------------------------------------------------------------------------
// 2. Keyboard walk (Accessibility floor: the Team selector, view tabs, member
// search, the Audit source filter, and every dialog).
// ---------------------------------------------------------------------------
test.describe("keyboard walk (L5 Accessibility floor)", () => {
  test("Team selector: type-ahead keys choose a team and the team URL parameter follows", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, teamUrl("budgets"));
    await teamPageReady(page, "budgets");

    // Exact name excludes "Team totals"; the page-header selector precedes the
    // Members region's own "Team" select in the DOM.
    const select = page
      .getByRole("combobox", { name: "Team", exact: true })
      .first();
    await select.focus();
    await expect(select).toBeFocused();
    await page.keyboard.type("Pl");

    await expect(page).toHaveURL(/[?&]team=t2(&|$)/);
    await expect(select).toHaveValue("t2");
    await expect(
      page.getByRole("region", { name: "Budget and limits" }),
    ).toBeVisible();
  });

  // Design System -- Management pages, Team: PageHeader holds "the view tabs
  // Members, Budgets, Keys" and *Team page views and links* (the one Tabs
  // component, `?view=` URL state); Design System -- Components, Tabs (Arrow /
  // Home / End). Moved here from L5b (coordinator ruling): the feature is B2b.
  test("Team view tabs: Arrow keys move between Members, Budgets, Keys and the URL records the view", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, TEAM_URL);
    await teamPageReady(page);

    const tablist = page.getByRole("tablist");
    await expect(tablist).toBeVisible();
    const tabs = tablist.getByRole("tab");
    await expect(tabs).toHaveText(["Members", "Budgets", "Keys"]);

    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/[?&]view=budgets(&|$)/);
    await expect(
      page.getByRole("region", { name: "Budget and limits" }),
    ).toBeVisible();

    await page.keyboard.press("End");
    await expect(tabs.nth(2)).toBeFocused();
    await expect(page).toHaveURL(/[?&]view=keys(&|$)/);

    await page.keyboard.press("Home");
    await expect(tabs.first()).toBeFocused();
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  });

  // Design System -- Management pages, *Team page views and links*: "Member
  // search on Members: a labelled search box ('Search members') filtering the
  // loaded member rows client-side by name or email, case-insensitive".
  test("Team member search: a labelled searchbox reachable by Tab from the view tabs, filtering members as you type", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, TEAM_URL);
    await teamPageReady(page);

    const search = page.getByRole("searchbox", { name: /search members/i });
    await expect(search).toBeVisible();
    await page
      .getByRole("tablist")
      .getByRole("tab", { name: "Members" })
      .focus();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      if (await search.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(search).toBeFocused();

    await page.keyboard.type("grace");
    const members = page.getByRole("region", { name: "LiteLLM members" });
    await expect(members).toContainText("Grace Hopper");
    await expect(members).not.toContainText("Ada Lovelace");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("zzz");
    await expect(members).toContainText(/no members match/i);
  });

  // Design System -- Management pages, Audit: segmented toggle, nuqs `source`,
  // buttons with aria-pressed (toggle buttons: Tab, Space and Enter operate
  // them; Arrow keys are not part of the toggle-button pattern).
  test("Audit source filter: Tab reaches Gateway, Space and Enter switch the source and the URL follows", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, "/dashboard/manage/audit");

    const group = page.getByRole("group", { name: "Audit source" });
    const app = group.getByRole("button", { name: "App" });
    const gateway = group.getByRole("button", { name: "Gateway" });
    await expect(app).toHaveAttribute("aria-pressed", "true");

    await app.focus();
    await page.keyboard.press("Tab");
    await expect(gateway).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/[?&]source=gateway/);
    await expect(gateway).toHaveAttribute("aria-pressed", "true");
    await expect(app).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("Shift+Tab");
    await expect(app).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(app).toHaveAttribute("aria-pressed", "true");
    await expect(page).not.toHaveURL(/[?&]source=gateway/);
  });

  // Form dialogs (FormDialog): add member, generate key, edit member limits,
  // edit key. The remove-member confirm is covered in manage-team.spec.ts.
  test.describe("form dialogs", () => {
    // The app membership "Add member" (Access "Members" section) is an inline
    // form, not a dialog, so only the LiteLLM panel's is walked.
    const FORM_DIALOGS: readonly [string, string, string, TeamView][] = [
      ["LiteLLM members", "Add member", "LiteLLM Add member", "members"],
      ["Keys", "Generate key", "Generate key", "keys"],
      [
        "LiteLLM members",
        "Edit limits for Ada Lovelace",
        "Edit limits",
        "members",
      ],
      ["Keys", "Edit key ci-key", "Edit key", "keys"],
    ];
    for (const [region, button, trigger, view] of FORM_DIALOGS) {
      test(`${trigger}: opens with focus inside, Escape closes, focus returns to the trigger`, async ({
        page,
        context,
      }) => {
        await signInAsTestUser(context, { roles: ["internal-admin"] });
        await mockApi(page);
        await open(page, teamUrl(view));
        await teamPageReady(page, view);

        await walkDialog(
          page,
          page
            .getByRole("region", { name: region, exact: true })
            .getByRole("button", { name: button, exact: true }),
          "dialog",
        );
      });
    }
  });

  // Confirm dialogs (AlertDialog) other than remove member. The same
  // ConfirmAction component backs reset budget and the rest.
  test.describe("confirm dialogs", () => {
    const CONFIRMS: readonly [string, TeamView][] = [
      ["Reset spend for Ada Lovelace", "members"],
      ["Reset spend for all members", "members"],
      ["Rotate key ci-key", "keys"],
      ["Delete key ci-key", "keys"],
    ];
    for (const [trigger, view] of CONFIRMS) {
      test(`${trigger}: Enter opens it with focus inside, Escape closes, focus returns to the trigger`, async ({
        page,
        context,
      }) => {
        await signInAsTestUser(context, { roles: ["internal-admin"] });
        await mockApi(page);
        await open(page, teamUrl(view));
        await teamPageReady(page, view);

        await walkDialog(
          page,
          page.getByRole("button", { name: trigger, exact: true }),
          "alertdialog",
        );
      });
    }
  });

  test("the shown-once key dialog opens with focus inside, Escape closes it and focus returns to Generate key", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, teamUrl("keys"));
    await teamPageReady(page, "keys");

    const trigger = page.getByRole("button", { name: "Generate key" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const form = page.getByRole("dialog", { name: "Generate key" });
    await expect(form).toBeVisible();
    await form
      .getByRole("combobox", { name: "Key owner" })
      .selectOption("oid-ada");
    const submit = form.getByRole("button", { name: "Generate", exact: true });
    await submit.focus();
    await page.keyboard.press("Enter");

    const shown = page.getByRole("dialog", { name: /key generated/i });
    await expect(shown).toContainText(KEY_VALUE);
    await focusIsInside(shown);
    await page.keyboard.press("Escape");
    await expect(shown).toBeHidden();
    await expect(page.getByText(KEY_VALUE)).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  // L5b review warning (B2b): the dialog returns focus to the button that
  // opened it, so after a rotation that is the key's Rotate button, not Generate.
  test("the shown-once key dialog after Rotate returns focus to that key's Rotate button", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, teamUrl("keys"));
    await teamPageReady(page, "keys");

    const rotate = page.getByRole("button", {
      name: "Rotate key ci-key",
      exact: true,
    });
    await rotate.focus();
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Confirm" }).click();

    const shown = page.getByRole("dialog", { name: /key generated/i });
    await expect(shown).toContainText(KEY_VALUE);
    await focusIsInside(shown);
    await page.keyboard.press("Escape");
    await expect(shown).toBeHidden();
    await expect(page.getByText(KEY_VALUE)).toHaveCount(0);
    await expect(rotate).toBeFocused();
  });
});

// ---------------------------------------------------------------------------
// 3. Text, not colour alone (Accessibility floor: "every state carries text").
// ---------------------------------------------------------------------------
test.describe("states carry text (L5 Accessibility floor)", () => {
  test("blocked and active keys are named in text on My usage", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page, { teams: [], ops: [] });
    await open(page, "/dashboard/me");

    const keys = page.getByRole("table", { name: "Your keys" });
    await expect(keys.getByRole("row", { name: /ci-key/ })).toContainText(
      "Active",
    );
    await expect(keys.getByRole("row", { name: /old-key/ })).toContainText(
      "Blocked",
    );
  });

  test("a blocked key is marked Blocked in text on the Team Keys panel", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, teamUrl("keys"));
    await teamPageReady(page, "keys");
    await expect(
      page
        .getByRole("region", { name: "Keys" })
        .getByRole("row", { name: /old-key/ }),
    ).toContainText("Blocked");
  });

  // App Teams spec AT4 + MI-D7: an unlinked team has no "not connected" empty
  // state and no spend panel on the Team page; its member sum lives on Team
  // usage (e2e/team-usage.spec.ts).
  test("an unlinked team shows the no-LiteLLM-team note and no spend panel (AT4, MI-D7)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page, {
      unlinkedTeam: true,
      teams: [{ teamId: "t1", teamName: "Payments", linked: false }],
    });
    await open(page, TEAM_URL);
    await expect(
      page.getByText("This team has no LiteLLM team of its own."),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Team spend", exact: true }),
    ).toHaveCount(0);
  });

  const UNAVAILABLE: readonly [string, string, string][] = [
    ["Team", TEAM_URL, "/api/litellm/me"],
    [
      "Organisation",
      "/dashboard/manage/litellm/organisation",
      "/api/litellm/org",
    ],
    ["My usage", "/dashboard/me", "/api/litellm/me"],
  ];
  for (const [label, path, endpoint] of UNAVAILABLE) {
    test(`${label}: an unreachable LiteLLM says "LiteLLM unavailable" in text`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await mockApi(page, { unavailable: [endpoint] });
      await open(page, path);
      await expect(
        pageBody(page).getByText("LiteLLM unavailable"),
      ).toBeVisible();
    });
  }

  test("under the Organisation cap, per-user cost reads as text, not a blank or a dash (LD23)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page, { capped: true });
    await open(page, "/dashboard/manage/users");
    await page.getByRole("searchbox", { name: /search users/i }).fill("ada");
    const row = page.getByRole("row", { name: /ada@example\.test/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText(
      "Hidden until per-user reporting is approved",
    );

    await page.getByRole("button", { name: "ada@example.test" }).click();
    await expect(
      page.getByRole("region", { name: /user usage/i }),
    ).toContainText("Hidden until per-user reporting is approved");
  });

  // Wording: coordinator ruling 2026-11-17 (the Users page wording).
  test("under the Organisation cap, the Team members table names the hidden figures in text (LD23)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page, { capped: true });
    await open(page, TEAM_URL);
    await expect(
      page.getByRole("region", { name: "LiteLLM members" }),
    ).toContainText("Ada Lovelace");
    const row = page
      .getByRole("region", { name: "LiteLLM members" })
      .getByRole("row", { name: /Ada Lovelace/ });
    await expect(row).toContainText(
      "Hidden until per-user reporting is approved",
    );
  });

  // The team-level bar moved to Team usage with the spend (MI-D7;
  // e2e/team-usage.spec.ts); the member rows keep theirs here.
  test("the member budget bar carries its percentage (or No limit) as text next to the bar", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, teamUrl("members"));
    await teamPageReady(page, "members");

    const members = page.getByRole("region", { name: "LiteLLM members" });
    const over = members.getByRole("row", { name: /Ada Lovelace/ });
    await expect(over.getByRole("progressbar")).toBeVisible();
    await expect(over).toContainText("107%");
    await expect(
      members.getByRole("row", { name: /Grace Hopper/ }),
    ).toContainText("No limit");
  });

  const PAGES: readonly [string, string][] = [
    ["Team", TEAM_URL],
    ["Organisation", "/dashboard/manage/litellm/organisation"],
    ["Users", "/dashboard/manage/users"],
    ["Audit", "/dashboard/manage/audit?source=gateway"],
    ["My usage", "/dashboard/me"],
  ];
  test("every icon-only button on the Management pages and My usage has an accessible name", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    for (const [label, path] of PAGES) {
      await open(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (path === TEAM_URL) await teamPageReady(page);
      const unnamed = await pageBody(page)
        .locator("button")
        .evaluateAll((buttons) =>
          buttons
            .filter((button) => (button.textContent ?? "").trim() === "")
            .filter(
              (button) =>
                !(button.getAttribute("aria-label") ?? "").trim() &&
                !button.getAttribute("aria-labelledby"),
            )
            .map((button) => button.outerHTML.slice(0, 120)),
        );
      expect(unnamed, `${label}: icon-only buttons without a name`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Responsive (Responsive: no horizontal scroll at 375/768/1024/1440/1920;
// LiteLLM tables render as cards below md). 375-1440 no-scroll is covered by
// accessibility.spec.ts and manage-team.spec.ts; 1920 is added here.
// ---------------------------------------------------------------------------
test.describe("responsive (L5 Responsive; Design System: Responsive Tables)", () => {
  const WIDE: readonly [string, string][] = [
    ["Team", TEAM_URL],
    ["Organisation", "/dashboard/manage/litellm/organisation"],
    ["Users", "/dashboard/manage/users"],
    ["Audit", "/dashboard/manage/audit"],
    ["My usage", "/dashboard/me"],
  ];
  for (const [label, path] of WIDE) {
    test(`${label} has no horizontal scroll at 1920px`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await mockApi(page);
      await open(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page, `${label} at 1920px`);
      // The L5b Verify line: axe clean at 1920 as well as 375-1440.
      await expectNoBlockingViolations(page);
    });
  }

  // Below md each LiteLLM table is a card list named like the table's caption
  // (UsageCardList: `ul[role=list]` labelled by the caption); from md the table
  // renders. `prepare` opens the page and waits for the data.
  type CardCase = {
    name: string;
    caption: string;
    roles: string[];
    rows: number;
    prepare: (page: Page) => Promise<void>;
  };
  const CARD_CASES: readonly CardCase[] = [
    {
      name: "Team members",
      caption: "Team members",
      roles: ["internal-admin"],
      rows: 2,
      prepare: async (page) => {
        await open(page, TEAM_URL);
        await expect(
          page.getByRole("region", { name: "LiteLLM members" }),
        ).toContainText("Ada Lovelace");
      },
    },
    {
      name: "Team keys",
      caption: "Team keys",
      roles: ["internal-admin"],
      rows: 2,
      prepare: async (page) => {
        await open(page, teamUrl("keys"));
        await expect(page.getByRole("region", { name: "Keys" })).toContainText(
          "ci-key",
        );
      },
    },
    {
      name: "My usage keys",
      caption: "Your keys",
      roles: ["internal-viewer"],
      rows: 2,
      prepare: async (page) => {
        await open(page, "/dashboard/me");
        await expect(page.getByText("ci-key")).toBeVisible();
      },
    },
    {
      name: "Gateway audit",
      caption: "LiteLLM audit entries",
      roles: ["internal-admin"],
      rows: 1,
      prepare: async (page) => {
        await open(page, "/dashboard/manage/audit?source=gateway");
        await expect(page.getByText("ops@example.test")).toBeVisible();
      },
    },
    // L4b: the Organisation view has two tables (App Teams spec, AT5; LiteLLM
    // spec L5b).
    {
      name: "Organisation LiteLLM teams",
      caption: "LiteLLM teams",
      roles: ["internal-admin"],
      rows: 1,
      prepare: async (page) => {
        await open(page, "/dashboard/manage/litellm/organisation");
        await expect(page.getByText("Payments LLM").first()).toBeVisible();
      },
    },
    {
      name: "Organisation App teams",
      caption: "App teams",
      roles: ["internal-admin"],
      rows: 1,
      prepare: async (page) => {
        await open(page, "/dashboard/manage/litellm/organisation");
        await expect(page.getByText("Payments").first()).toBeVisible();
      },
    },
  ];
  for (const { name, caption, roles, rows, prepare } of CARD_CASES) {
    test(`${name}: cards at 375px, a table from 768px`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles });
      await mockApi(page, {
        teams: roles.includes("internal-viewer") ? [] : TEAMS,
      });
      await page.setViewportSize({ width: 375, height: 900 });
      await prepare(page);
      const cards = page.getByRole("list", { name: caption });
      await expect(
        page.getByRole("table", { name: caption }),
        `${name} still renders a <table> below md`,
      ).toHaveCount(0);
      await expect(cards, `${name} has no card list below md`).toBeVisible();
      await expect(cards.getByRole("listitem")).toHaveCount(rows);
      await expectNoHorizontalScroll(page, `${name} at 375px`);
      // L5b review warning (B2b): the card layout is axe-clean too.
      await expectNoBlockingViolations(page);

      await page.setViewportSize({ width: 768, height: 900 });
      await expect(page.getByRole("table", { name: caption })).toBeVisible();
      await expect(page.getByRole("list", { name: caption })).toHaveCount(0);
    });
  }

  // UserSearch's results table is captioned "User results" (coordinator ruling,
  // L5b, 2026-11-17); below md it is a card list of the same name.
  test("User search results: cards at 375px, a table from 768px", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await page.setViewportSize({ width: 375, height: 900 });
    await open(page, "/dashboard/manage/users");
    await page.getByRole("searchbox", { name: /search users/i }).fill("ada");

    const cards = page.getByRole("list", { name: "User results" });
    await expect(cards, "no card list below md").toBeVisible();
    await expect(cards.getByRole("listitem")).toHaveCount(1);
    await expect(cards).toContainText("ada@example.test");
    await expect(
      page.getByRole("table", { name: "User results" }),
      "user results still render a <table> below md",
    ).toHaveCount(0);
    await expectNoHorizontalScroll(page, "user results at 375px");

    await page.setViewportSize({ width: 768, height: 900 });
    await expect(
      page.getByRole("table", { name: "User results" }),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "User results" })).toHaveCount(
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. prefers-reduced-motion (Accessibility floor: "motion respects
// prefers-reduced-motion"; Design System -- Animation; the floor in
// app/globals.css).
// ---------------------------------------------------------------------------
test.describe("reduced motion (L5 Accessibility floor)", () => {
  test("a dialog opens with no animation or transition longer than a frame when reduced motion is requested", async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page, TEAM_URL);
    await teamPageReady(page);

    await page
      .getByRole("region", { name: "LiteLLM members" })
      .getByRole("button", { name: "Add member" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Add member" }),
    ).toBeVisible();

    const seconds = await page.evaluate(() => {
      const toSeconds = (list: string) =>
        list.split(",").map((part) => {
          const value = parseFloat(part);
          return part.trim().endsWith("ms") ? value / 1000 : value;
        });
      return [
        '[data-slot="dialog-overlay"]',
        '[data-slot="dialog-content"]',
      ].flatMap((selector) => {
        const el = document.querySelector(selector);
        if (!el) return [Number.NaN];
        const cs = getComputedStyle(el);
        return [
          ...toSeconds(cs.animationDuration),
          ...toSeconds(cs.transitionDuration),
        ];
      });
    });
    expect(seconds.length).toBeGreaterThan(0);
    for (const duration of seconds) {
      expect(duration).toBeLessThanOrEqual(0.001);
    }
  });
});
