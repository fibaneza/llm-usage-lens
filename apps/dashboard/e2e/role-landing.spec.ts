import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  PROBE_DEPARTMENT,
  PROBE_ROLES,
  PROBE_TEAM,
  seedRoleProbe,
  type ProbeRole,
} from "../test/fixtures/role-probe-seed";

import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Source: Access Control - Navigation and landing by role (the matrix: Usage
// for admin / org admin / auditor only, My usage last in Usage for everyone (B1-14),
// Administration - Settings; landing: admin -> Cost overview, lead and user ->
// My usage; "Hidden means absent and 404"); Design System - Navigation
// (Sidebar) (groups Usage / Management / Administration, footer holds only the
// collapse button) and Layout (sync badges absent for lead and user);
// implementation-phases Phase 5 Slice B tests ("one e2e journey per role
// (admin, lead, user)"); slice B1 brief B1-1..B1-9. The probe identities are
// seeded into DynamoDB Local by test/fixtures/role-probe-seed.ts on top of
// `pnpm db:seed` (team-payments in dept-engineering); sessions are forged like
// every e2e session (e2e/support/session.ts, no auth bypass). The landing
// redirect matrix per caller is asserted at the integration layer
// (app/dashboard/*.integration.test.ts), the per-role item lists at the unit
// layer (lib/nav.test.ts); each journey here walks what only a browser shows.
// Idempotent puts: every worker may seed, none removes (a re-seed clears them).
test.beforeAll(seedRoleProbe);

const byName = (name: string): ProbeRole => {
  const role = PROBE_ROLES.find((r) => r.name === name);
  if (!role) throw new Error(`unknown probe role ${name}`);
  return role;
};

async function open(
  page: Page,
  context: BrowserContext,
  role: ProbeRole,
  path: string,
) {
  await signInAsTestUser(context, { oid: role.oid, roles: role.roles });
  await page.goto(path);
  await waitForHydration(page);
}

type Item = {
  title: string;
  pageTitle: string;
  path: string;
  // Opens `<path>` or one of its tab routes `<path>/<tab>`.
  tabRoutes?: boolean;
};
type Group = { label: string; items: Item[] };

const TEAM_USAGE_ITEM: Item = {
  title: "Team usage",
  pageTitle: "Team usage",
  path: "/dashboard/team-usage",
};
const USAGE: Group = {
  label: "Usage",
  items: [
    { title: "Overview", pageTitle: "Cost overview", path: "/dashboard" },
    { title: "My usage", pageTitle: "My usage", path: "/dashboard/me" },
    TEAM_USAGE_ITEM,
    { title: "Ranking", pageTitle: "Cost ranking", path: "/dashboard/ranking" },
    {
      title: "Cost by department",
      pageTitle: "Cost by department",
      path: "/dashboard/departments",
    },
    {
      title: "Cost by team",
      pageTitle: "Cost by team",
      path: "/dashboard/teams",
    },
    {
      title: "Cost by service",
      pageTitle: "Cost by service",
      path: "/dashboard/services",
    },
    {
      title: "Cost by user",
      pageTitle: "Cost by user",
      path: "/dashboard/users",
    },
  ],
};
// MI-D1 / MI-D7: My usage is second, Team usage third where the teamUsage flag
// is true (every global reader, and a lead with a live scope). A caller with no
// scope holds only My usage.
const USAGE_MY_USAGE_ONLY: Group = {
  label: "Usage",
  items: [{ title: "My usage", pageTitle: "My usage", path: "/dashboard/me" }],
};
const USAGE_LEAD: Group = {
  label: "Usage",
  items: [
    { title: "My usage", pageTitle: "My usage", path: "/dashboard/me" },
    TEAM_USAGE_ITEM,
  ],
};
const ORG_USAGE_TITLES = USAGE.items
  .filter((i) => i.path !== "/dashboard/me")
  .map((i) => i.title);
// Slice B2 (B2-2; Design System - Navigation (Sidebar) routes table): the
// Management group is the four pages, each by capability.
const TEAM_ITEM: Item = {
  title: "Team",
  pageTitle: "Team management",
  path: "/dashboard/manage/team",
};
// MI-D2: the LiteLLM area replaces Organisation; the index redirects to the
// first visible tab (route tabs), so the walk accepts a tab route.
const LITELLM_ITEM: Item = {
  title: "LiteLLM",
  pageTitle: "LiteLLM",
  path: "/dashboard/manage/litellm",
  tabRoutes: true,
};
const USERS_ITEM: Item = {
  title: "Users",
  pageTitle: "Users",
  path: "/dashboard/manage/users",
};
const AUDIT_ITEM: Item = {
  title: "Audit",
  pageTitle: "Audit log",
  path: "/dashboard/manage/audit",
};
const MANAGEMENT_ALL: Group = {
  label: "Management",
  items: [USERS_ITEM, TEAM_ITEM, LITELLM_ITEM, AUDIT_ITEM],
};
// An org admin reads neither audit source (Access Control, Audit for org admin).
const MANAGEMENT_NO_AUDIT: Group = {
  label: "Management",
  items: [USERS_ITEM, TEAM_ITEM, LITELLM_ITEM],
};
const MANAGEMENT_TEAM_ONLY: Group = {
  label: "Management",
  items: [TEAM_ITEM],
};
const MANAGEMENT_PATHS = [LITELLM_ITEM.path, USERS_ITEM.path, AUDIT_ITEM.path];
const SETTINGS_PATHS = [
  "/dashboard/settings",
  "/dashboard/settings/accounts",
  "/dashboard/settings/sync",
  "/dashboard/settings/litellm",
  "/dashboard/settings/access/people",
];
const ADMINISTRATION: Group = {
  label: "Administration",
  items: [
    {
      title: "Settings",
      pageTitle: "Settings",
      path: "/dashboard/settings",
      tabRoutes: true,
    },
  ],
};

// W3 (round-1 review): the sidebar <nav> is named "Primary"; selectors address
// it by role. The Collapse button sits in the footer, outside the nav.
const primaryNav = (page: Page) =>
  page.getByRole("navigation", { name: "Primary" });
const topBar = (page: Page) =>
  page.locator('[data-slot="sidebar-inset"] > header');
const sidebarLink = (page: Page, name: string) =>
  primaryNav(page).getByRole("link", { name, exact: true });
const pathPattern = (path: string, tabRoutes = false) =>
  new RegExp(
    `${path.replaceAll("/", "\\/")}${tabRoutes ? "(\\/[a-z-]+)*" : ""}(\\?|$)`,
  );

// The sidebar shows exactly these groups and items, the footer holds only the
// collapse button, then every item opens a page whose h1 is its page title.
async function expectSidebarAndWalk(page: Page, groups: Group[]) {
  // Group labels are text in the nav; the link list fixes the order. A group
  // the caller has no item for is not rendered (B2-2).
  for (const group of groups) {
    await expect(
      primaryNav(page).getByText(group.label, { exact: true }),
    ).toBeVisible();
  }
  for (const label of ["Usage", "Management", "Administration"]) {
    if (!groups.some((g) => g.label === label)) {
      await expect(
        primaryNav(page).getByText(label, { exact: true }),
      ).toHaveCount(0);
    }
  }
  await expect(primaryNav(page).getByRole("link")).toHaveText(
    groups.flatMap((g) => g.items.map((i) => i.title)),
  );
  await expect(
    page.getByRole("button", { name: "Collapse", exact: true }),
  ).toBeVisible();

  for (const item of groups.flatMap((g) => g.items)) {
    await sidebarLink(page, item.title).click();
    // Design System - Settings Page: the index redirects on the server to the
    // caller's first visible tab, so the Settings link ends on a tab route.
    await expect(page).toHaveURL(pathPattern(item.path, item.tabRoutes));
    await expect(
      page.getByRole("heading", { level: 1, name: item.pageTitle }),
    ).toBeVisible();
  }
}

async function expectNotFound(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `${path} status`).toBe(404);
  await expect(page.getByText(/this page could not be found/i)).toBeVisible();
}

const HIDDEN_USAGE_PATHS = [
  "/dashboard/ranking",
  "/dashboard/departments",
  `/dashboard/departments/${PROBE_DEPARTMENT}`,
  "/dashboard/teams",
  `/dashboard/teams/${PROBE_TEAM}`,
  "/dashboard/services",
  "/dashboard/users",
];

test.describe("journey: admin", () => {
  test("lands on Cost overview, sees every group, every link opens its page, sync status is in the top bar", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("internal-admin"), "/dashboard");

    await expect(page).toHaveURL(/\/dashboard(\?|$)/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Cost overview" }),
    ).toBeVisible();
    await expect(topBar(page).getByRole("status")).toBeVisible();
    await expect(topBar(page).getByRole("timer")).toBeVisible();

    await expectSidebarAndWalk(page, [USAGE, MANAGEMENT_ALL, ADMINISTRATION]);
  });
});

// B2 journeys for the two global readers the B1 specs did not walk (Access
// Control - Navigation and landing by role: org admin, auditor; landing Cost
// overview; the auditor reads every Management page and Settings read-only).
test.describe("journey: org admin", () => {
  test("lands on Cost overview, sees Management without Audit and Settings, and Audit is a 404", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("internal-org-admin"), "/dashboard");

    await expect(
      page.getByRole("heading", { level: 1, name: "Cost overview" }),
    ).toBeVisible();
    await expectSidebarAndWalk(page, [
      USAGE,
      MANAGEMENT_NO_AUDIT,
      ADMINISTRATION,
    ]);
    await expectNotFound(page, AUDIT_ITEM.path);
  });
});

test.describe("journey: auditor", () => {
  test("lands on Cost overview, sees every Management page and Settings, every link opens its page", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("internal-auditor"), "/dashboard");

    await expect(
      page.getByRole("heading", { level: 1, name: "Cost overview" }),
    ).toBeVisible();
    await expectSidebarAndWalk(page, [USAGE, MANAGEMENT_ALL, ADMINISTRATION]);
  });
});

test.describe("journey: lead (team admin)", () => {
  test("lands on My usage, sees Usage (My usage only) and Management (Team only), no Administration, every link opens its page, no sync badge", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("team-admin"), "/dashboard");

    await expect(page).toHaveURL(pathPattern("/dashboard/me"));
    await expect(
      page.getByRole("heading", { level: 1, name: "My usage" }),
    ).toBeVisible();
    await expect(topBar(page).getByRole("status")).toHaveCount(0);
    await expect(topBar(page).getByRole("timer")).toHaveCount(0);
    // The date range stays for every role (Design System - Layout).
    await expect(
      topBar(page).getByRole("button", { name: "Last 30 days" }),
    ).toBeVisible();

    await expectSidebarAndWalk(page, [USAGE_LEAD, MANAGEMENT_TEAM_ONLY]);
  });

  test("every Usage route, the other Management pages and every Settings route are a 404 (B1-2, B2-1, B2-10)", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("team-admin"), "/dashboard/me");

    for (const path of [
      ...HIDDEN_USAGE_PATHS,
      ...MANAGEMENT_PATHS,
      ...SETTINGS_PATHS,
    ]) {
      await expectNotFound(page, path);
    }
  });

  test("opens the Team page for the team it leads, and a team it does not lead is a 404", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("team-admin"), "/dashboard/me");

    const own = await page.goto(`${TEAM_ITEM.path}/${PROBE_TEAM}`);
    expect(own?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: TEAM_ITEM.pageTitle }),
    ).toBeVisible();
    await expectNotFound(page, `${TEAM_ITEM.path}/not-a-team-it-leads`);
  });

  // Design System - Management pages, "List, then the team" (U-W2, review r1):
  // a lead's list holds only the team it leads, shows no LiteLLM team id (only
  // "Linked" / "Not linked", The LiteLLM team column by role), and the row
  // opens that team's page.
  test("the Team list holds only the lead's team, shows no LiteLLM team id, and its row opens the team page", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("team-admin"), "/dashboard/me");
    await page.goto(TEAM_ITEM.path);
    await waitForHydration(page);

    const table = page.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(2);
    const row = table.getByRole("row", { name: /Payments/ });
    await expect(row.getByRole("cell").last()).toHaveText(
      /^(Linked|Not linked)$/,
    );
    await table.getByRole("link", { name: "Payments", exact: true }).click();
    await expect(page).toHaveURL(
      pathPattern(`${TEAM_ITEM.path}/${PROBE_TEAM}`),
    );
    await expect(
      page.getByRole("heading", { level: 1, name: TEAM_ITEM.pageTitle }),
    ).toBeVisible();
  });

  // Design System - Management pages (Team: the ScopeLine for a lead; the lead's
  // team-scoped access actions) and the B2 review: the Team admins table has no
  // clipped action at 375. The row action is the "Revoke admin <name>" icon button.
  test("the Team page states the lead's scope and its Team admins actions fit at 375", async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await open(page, context, byName("team-admin"), "/dashboard/me");
    await page.goto(`${TEAM_ITEM.path}/${PROBE_TEAM}`);
    await waitForHydration(page);

    await expect(page.getByText("Showing teams you lead")).toBeVisible();

    const revoke = page.getByRole("button", { name: /^Revoke admin / });
    await expect(revoke.first()).toBeVisible();
    for (const button of await revoke.all()) {
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375);
      await expect(button).toBeEnabled();
      await button.click({ trial: true });
    }
  });

  test("the retired LiteLLM routes still work: ?tab=team lands on Team, ?tab=audit is a 404", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("team-admin"), "/dashboard/me");

    await page.goto("/dashboard/litellm?tab=team");
    await expect(page).toHaveURL(pathPattern(TEAM_ITEM.path));
    await expectNotFound(page, "/dashboard/litellm?tab=audit");
  });

  test("the retired ?view=overview link still lands on My usage", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("team-admin"), "/dashboard?view=overview");

    await expect(page).toHaveURL(pathPattern("/dashboard/me"));
  });
});

// Review RS2 round 3 (Design System - "Reset any LiteLLM user", D-RS7, Q19;
// LiteLLM LD34): the real team-scope Lead (team-admin on team-payments, seeded
// by the role-probe fixture) opens the Team page reset dialog and is offered
// the user-level scope. The LiteLLM API is fulfilled from fixtures (Rule 60.24).
test.describe("journey: lead reset dialog (RS2, D-RS7, Q19)", () => {
  test("a Lead opens a member's Reset spend dialog and sees User spend (all of LiteLLM) (RS2, D-RS7, Q19)", async ({
    context,
    page,
  }) => {
    const ops = ["resetMemberSpend", "resetMemberBudget", "resetUserSpend"];
    await page.route(/\/api\/sync-status(\?|$)/, (route) =>
      route.fulfill({ json: { data: { state: "never-synced" } } }),
    );
    await page.route(/\/api\/litellm\//, (route) => {
      const url = new URL(route.request().url());
      const key = `${route.request().method()} ${url.pathname}`;
      const ok = (data: unknown) => route.fulfill({ json: { data } });
      switch (key) {
        case "GET /api/litellm/me":
          return ok({
            linked: false,
            enabledOperations: ops,
            teams: [
              {
                teamId: PROBE_TEAM,
                teamName: "Payments",
                linked: true,
                configurable: true,
              },
            ],
          });
        case `GET /api/litellm/teams/${PROBE_TEAM}`:
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
            daily: [{ date: "2026-11-14", spend: 321.75 }],
            enabledOperations: ops,
          });
        case `GET /api/litellm/teams/${PROBE_TEAM}/members`:
          return ok({
            connected: true,
            litellmTeamId: "ll-1",
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
        case `GET /api/litellm/teams/${PROBE_TEAM}/keys`:
          return ok({ connected: true, items: [] });
        default:
          return route.fulfill({
            status: 404,
            json: { error: { code: "NOT_FOUND", message: "not found" } },
          });
      }
    });
    await open(
      page,
      context,
      byName("team-admin"),
      `/dashboard/manage/team/${PROBE_TEAM}`,
    );
    await page
      .getByRole("button", { name: "Reset spend for Ada Lovelace" })
      .click();
    const dialog = page.getByRole("alertdialog", {
      name: "Reset spend for Ada Lovelace?",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: "This team only" }),
    ).toBeChecked();
    await expect(
      dialog.getByRole("radio", { name: "User spend (all of LiteLLM)" }),
    ).toBeVisible();
  });
});

// INV2 (Access Control - "Placing a person by hand": Invite, Add to team and
// Approve and add for "a lead in scope"; Design System - Members panel, each
// action confirms naming the person and the team, Cancel focused first): the
// real team-scope Lead (team-admin on team-payments) places three people from
// the Team page. The other roles' journeys, axe and the 375 px checks are in
// team-invite-approve.spec.ts; the Lead's scope lives in the probe table, so
// its journey runs in this project. The LiteLLM API and the three writes are
// fulfilled from fixtures (Rule 60.24).
test.describe("journey: lead places a person by hand (INV2)", () => {
  test("a Lead in scope invites, adds to the team and approves and adds from the Team page", async ({
    context,
    page,
  }) => {
    const ops = ["addTeamMember", "removeTeamMember"];
    const written: unknown[] = [];
    let sam = false;
    let ivy = false;
    const base = { spend: 5, maxBudget: 10, rpmLimit: null, tpmLimit: null };
    await page.route(/\/api\/sync-status(\?|$)/, (route) =>
      route.fulfill({ json: { data: { state: "never-synced" } } }),
    );
    await page.route(/\/api\/litellm\//, (route) => {
      const url = new URL(route.request().url());
      const key = `${route.request().method()} ${url.pathname}`;
      const ok = (data: unknown) => route.fulfill({ json: { data } });
      switch (key) {
        case "GET /api/litellm/me":
          return ok({
            linked: false,
            enabledOperations: ops,
            teams: [
              {
                teamId: PROBE_TEAM,
                teamName: "Payments",
                linked: true,
                configurable: true,
              },
            ],
          });
        case `GET /api/litellm/teams/${PROBE_TEAM}`:
          return ok({
            connected: true,
            spendSource: "litellm-team",
            team: {
              alias: "Payments",
              spend: 10,
              maxBudget: 500,
              softBudget: null,
              budgetDuration: "30d",
              models: ["claude-sonnet"],
              rpmLimit: null,
              tpmLimit: null,
            },
            daily: [{ date: "2026-11-14", spend: 10 }],
            enabledOperations: ops,
          });
        case `GET /api/litellm/teams/${PROBE_TEAM}/members`:
          return ok({
            connected: true,
            candidates: [],
            items: [
              {
                ...base,
                userId: "u-ext1",
                email: "ext1@example.test",
                state: "unknown",
              },
              sam
                ? {
                    ...base,
                    userId: "u-sam",
                    oid: "oid-sam",
                    name: "Sam Rowe",
                    email: "sam@example.test",
                  }
                : {
                    ...base,
                    userId: "u-sam",
                    email: "sam@example.test",
                    state: "signed-in",
                    identityOid: "oid-sam",
                    identityName: "Sam Rowe",
                    identityEmail: "sam.rowe@corp.example.test",
                  },
              ivy
                ? {
                    ...base,
                    userId: "u-ivy",
                    oid: "oid-ivy",
                    name: "Ivy Chen",
                    email: "ivy@example.test",
                  }
                : {
                    ...base,
                    userId: "u-ivy",
                    email: "ivy@example.test",
                    state: "invited",
                  },
            ],
          });
        case `GET /api/litellm/teams/${PROBE_TEAM}/keys`:
          return ok({ connected: true, items: [] });
        default:
          return route.fulfill({
            status: 404,
            json: { error: { code: "NOT_FOUND", message: "not found" } },
          });
      }
    });
    await page.route(
      new RegExp(`/api/teams/${PROBE_TEAM}/members$`),
      (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        const body = route.request().postDataJSON() as { oid?: string };
        written.push(body);
        if (body.oid === "oid-sam") sam = true;
        return route.fulfill({ status: 201, json: { data: { ok: true } } });
      },
    );
    await page.route(
      /\/members\/pending\/ivy(%40|@)example\.test\//,
      (route) => {
        if (route.request().method() === "POST") {
          written.push(route.request().postDataJSON());
          ivy = true;
          return route.fulfill({
            json: { data: { oid: "oid-ivy", teamId: PROBE_TEAM } },
          });
        }
        return route.fulfill({
          json: {
            data: {
              items: [
                {
                  oid: "oid-ivy",
                  displayName: "Ivy Chen",
                  upn: "ivy@example.test",
                  email: "ivy@example.test",
                  exact: true,
                  signal: "upn",
                },
              ],
            },
          },
        });
      },
    );
    await open(
      page,
      context,
      byName("team-admin"),
      `/dashboard/manage/team/${PROBE_TEAM}`,
    );
    const panel = page.getByRole("region", { name: "LiteLLM members" });

    await panel
      .getByRole("button", { name: "Invite ext1@example.test" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect.poll(() => written.length).toBe(1);

    await panel
      .getByRole("button", { name: "Add sam@example.test to team" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect(
      panel.getByRole("button", { name: "Remove Sam Rowe" }),
    ).toBeVisible();

    await panel
      .getByRole("button", { name: "Approve and add ivy@example.test" })
      .click();
    const accept = page.getByRole("dialog", { name: /approve and add/i });
    await accept.getByLabel(/reason/i).fill("Same person");
    await accept.getByRole("button", { name: "Confirm" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Add to team" })
      .click();
    await expect(
      panel.getByRole("button", { name: "Remove Ivy Chen" }),
    ).toBeVisible();
    expect(written).toEqual([
      { emailOrUpn: "ext1@example.test" },
      { oid: "oid-sam" },
      { oid: "oid-ivy", reason: "Same person" },
    ]);
  });
});

test.describe("journey: user (member)", () => {
  test("lands on My usage, sees the Usage group with My usage only and no Management or Administration, no sync badge", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("member"), "/dashboard");

    await expect(page).toHaveURL(pathPattern("/dashboard/me"));
    await expect(
      page.getByRole("heading", { level: 1, name: "My usage" }),
    ).toBeVisible();
    await expect(topBar(page).getByRole("status")).toHaveCount(0);
    await expect(topBar(page).getByRole("timer")).toHaveCount(0);
    await expect(
      topBar(page).getByRole("button", { name: "Last 30 days" }),
    ).toBeVisible();

    await expectSidebarAndWalk(page, [USAGE_MY_USAGE_ONLY]);
  });

  test("every Usage route, every Management page and every Settings route are a 404 (B1-2, B2-1, B2-10)", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("member"), "/dashboard/me");

    for (const path of [
      ...HIDDEN_USAGE_PATHS,
      TEAM_ITEM.path,
      ...MANAGEMENT_PATHS,
      ...SETTINGS_PATHS,
    ]) {
      await expectNotFound(page, path);
    }
  });
});

// Kept from 4R.5: My usage states (implementation-phases Phase 4R.5; Design
// System - Access states and scoped labels: No team, "Ask your team lead for
// access").
test.describe("My usage (/dashboard/me)", () => {
  test("renders for a member with their heading, without console errors", async ({
    context,
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await open(page, context, byName("member"), "/dashboard/me");
    await expect(
      page.getByRole("heading", { name: "My usage", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /your bedrock usage/i }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a viewer with no team sees "Ask your team lead for access" and a trimmed sidebar', async ({
    context,
    page,
  }) => {
    await open(page, context, byName("viewer-no-team"), "/dashboard/me");
    await expect(
      page.getByText(/ask your team lead for access/i),
    ).toBeVisible();
    await expect(sidebarLink(page, "My usage")).toBeVisible();
    for (const gone of [...ORG_USAGE_TITLES, "Team usage", "LiteLLM"]) {
      await expect(sidebarLink(page, gone)).toHaveCount(0);
    }
  });

  test("a member with a team does not see the no-team prompt", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("member"), "/dashboard/me");
    await expect(page.getByText(/your bedrock usage/i)).toBeVisible();
    await expect(page.getByText(/ask your team lead for access/i)).toHaveCount(
      0,
    );
  });

  // B2-11: the chart sections render from the caller's own usage; the probe
  // table carries no usage for the member, so the empty state shows and the
  // charts stay out. The request-a-budget-increase link is absent without a
  // known lead.
  test("a member with no usage in range sees no charts and no budget-increase link", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("member"), "/dashboard/me");

    await expect(
      page.getByRole("heading", { name: "Spend by day" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Request a budget increase" }),
    ).toHaveCount(0);
  });
});

// Unit M2 (Design System -- Management pages, Team usage and New team; Access
// Control -- Created app teams, T-MI4): the lead and user cases that need the
// probe identities. A global reader's Team usage and the admin's New team
// journey are in team-usage.spec.ts and team-create.spec.ts. The server gate
// reads only DynamoDB; the browser's LiteLLM calls are fulfilled from fixtures.
const GUILD_ID = "appteam-00000000-0000-4000-8000-000000000001";

async function stubTeamSpend(page: Page) {
  await page.route(/\/api\/litellm\/teams\/[^/?]+(\?|$)/, (route) =>
    route.fulfill({
      json: {
        data: {
          connected: false,
          spendSource: "member-sum",
          daily: [],
          memberSum: {
            total: 0,
            daily: [],
            coverage: { members: 0, matched: 0, unmatched: 0, pending: 0 },
            members: [],
          },
        },
      },
    }),
  );
}

test.describe("journey: Team usage and New team by scope (unit M2, T-MI4)", () => {
  test("a team lead sees only the team it leads on Team usage; another team, even one in the same department, is a 404", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("team-admin"), "/dashboard/me");
    await stubTeamSpend(page);

    const own = await page.goto(`/dashboard/team-usage?team=${PROBE_TEAM}`);
    expect(own?.status()).toBe(200);
    await waitForHydration(page);
    await expect(
      page.getByRole("region", { name: "Team spend", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Team", exact: true }),
    ).toHaveCount(0);

    await expectNotFound(page, "/dashboard/team-usage?team=team-platform");
    await expectNotFound(page, `/dashboard/team-usage?team=${GUILD_ID}`);
    await expectNotFound(page, "/dashboard/team-usage?team=team-analytics");
  });

  test("a department lead's picker lists the teams of its department, including the created team, and no other", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("department-admin"), "/dashboard/me");
    await stubTeamSpend(page);
    await page.goto(`/dashboard/team-usage?team=${PROBE_TEAM}`);
    await waitForHydration(page);

    const picker = page.getByRole("combobox", { name: "Team", exact: true });
    await expect(picker.getByRole("option")).toHaveText([
      "Payments",
      "Platform",
      "Platform Guild",
    ]);
  });

  // Design System - "List, then the team" (U-W1, review r1): a department
  // lead's list holds the teams of its department, registry and created, and
  // each opens.
  test("a department lead's Team list shows its department's teams and opening one gives 200", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("department-admin"), "/dashboard/me");
    await page.goto(TEAM_ITEM.path);
    await waitForHydration(page);

    const table = page.getByRole("table");
    await expect(table.getByRole("link")).toHaveText([
      "Payments",
      "Platform",
      "Platform Guild",
    ]);
    await table
      .getByRole("link", { name: "Platform Guild", exact: true })
      .click();
    await expect(page).toHaveURL(pathPattern(`${TEAM_ITEM.path}/${GUILD_ID}`));
    const opened = await page.goto(`${TEAM_ITEM.path}/${GUILD_ID}`);
    expect(opened?.status()).toBe(200);
  });

  for (const name of ["member", "viewer-no-team"]) {
    test(`${name}: Team usage is a 404`, async ({ context, page }) => {
      await open(page, context, byName(name), "/dashboard/me");
      await expectNotFound(page, "/dashboard/team-usage");
      await expectNotFound(page, `/dashboard/team-usage?team=${PROBE_TEAM}`);
    });
  }

  test("a team lead's Team page has no New team button (D5)", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("team-admin"), "/dashboard/me");
    await page.route(/\/api\/litellm\/me(\?|$)/, (route) =>
      route.fulfill({
        json: {
          data: {
            linked: false,
            enabledOperations: [],
            teams: [
              {
                teamId: PROBE_TEAM,
                teamName: "Payments",
                linked: false,
                configurable: true,
              },
            ],
          },
        },
      }),
    );
    // Unit TM1 (D-TM4): New team is on the Team list, which a lead sees with
    // its own teams; the team page has neither the button nor a picker.
    await page.goto(TEAM_ITEM.path);
    await waitForHydration(page);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("button", { name: "New team" })).toHaveCount(0);
    await page.goto(`${TEAM_ITEM.path}/${PROBE_TEAM}`);
    await waitForHydration(page);
    await expect(page.getByRole("button", { name: "New team" })).toHaveCount(0);
    // m2-r1 UI WARN: Team spend belongs to Team usage, not the Team page.
    await expect(
      page.getByRole("region", { name: "Team spend", exact: true }),
    ).toHaveCount(0);
  });
});
