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

const USAGE: Group = {
  label: "Usage",
  items: [
    { title: "Overview", pageTitle: "Cost overview", path: "/dashboard" },
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
    { title: "My usage", pageTitle: "My usage", path: "/dashboard/me" },
  ],
};
// B1-14 (2026-11-17): a non-global caller's Usage group holds only My usage.
const USAGE_MY_USAGE_ONLY: Group = {
  label: "Usage",
  items: [{ title: "My usage", pageTitle: "My usage", path: "/dashboard/me" }],
};
const ORG_USAGE_TITLES = USAGE.items
  .filter((i) => i.path !== "/dashboard/me")
  .map((i) => i.title);
// Slice B2 (B2-2; Design System - Navigation (Sidebar) routes table): the
// Management group is the four pages, each by capability.
const TEAM_ITEM: Item = {
  title: "Team",
  pageTitle: "Team usage & management",
  path: "/dashboard/manage/team",
};
const ORGANISATION_ITEM: Item = {
  title: "Organisation",
  pageTitle: "Organisation usage",
  path: "/dashboard/manage/organisation",
};
const USERS_ITEM: Item = {
  title: "Users",
  pageTitle: "User lookup",
  path: "/dashboard/manage/users",
};
const AUDIT_ITEM: Item = {
  title: "Audit",
  pageTitle: "Audit log",
  path: "/dashboard/manage/audit",
};
const MANAGEMENT_ALL: Group = {
  label: "Management",
  items: [TEAM_ITEM, ORGANISATION_ITEM, USERS_ITEM, AUDIT_ITEM],
};
// An org admin reads neither audit source (Access Control, Audit for org admin).
const MANAGEMENT_NO_AUDIT: Group = {
  label: "Management",
  items: [TEAM_ITEM, ORGANISATION_ITEM, USERS_ITEM],
};
const MANAGEMENT_TEAM_ONLY: Group = {
  label: "Management",
  items: [TEAM_ITEM],
};
const MANAGEMENT_PATHS = [
  ORGANISATION_ITEM.path,
  USERS_ITEM.path,
  AUDIT_ITEM.path,
];
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

    await expectSidebarAndWalk(page, [
      USAGE_MY_USAGE_ONLY,
      MANAGEMENT_TEAM_ONLY,
    ]);
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

    const own = await page.goto(`${TEAM_ITEM.path}?team=${PROBE_TEAM}`);
    expect(own?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: TEAM_ITEM.pageTitle }),
    ).toBeVisible();
    await expectNotFound(page, `${TEAM_ITEM.path}?team=not-a-team-it-leads`);
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
    await page.goto(`${TEAM_ITEM.path}?team=${PROBE_TEAM}`);
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
    for (const gone of ORG_USAGE_TITLES) {
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
