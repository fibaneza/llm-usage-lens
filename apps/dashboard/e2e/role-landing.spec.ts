import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  PROBE_DEPARTMENT,
  PROBE_ROLES,
  PROBE_TEAM,
  seedRoleProbe,
  type ProbeRole,
} from "../test/role-probe-seed";

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
// seeded into DynamoDB Local by test/role-probe-seed.ts on top of
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
const MANAGEMENT: Group = {
  label: "Management",
  items: [
    {
      title: "LiteLLM",
      pageTitle: "LiteLLM usage & administration",
      path: "/dashboard/litellm",
    },
  ],
};
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
  // Group labels are text in the nav; the link list fixes the order.
  for (const group of groups) {
    await expect(
      primaryNav(page).getByText(group.label, { exact: true }),
    ).toBeVisible();
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

    await expectSidebarAndWalk(page, [USAGE, MANAGEMENT, ADMINISTRATION]);
  });
});

test.describe("journey: lead (team admin)", () => {
  test("lands on My usage, sees Usage (My usage only), Management and Administration, every link opens its page, no sync badge", async ({
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
      MANAGEMENT,
      ADMINISTRATION,
    ]);
  });

  test("every Usage route is a 404 (B1-2)", async ({ context, page }) => {
    await open(page, context, byName("team-admin"), "/dashboard/me");

    for (const path of HIDDEN_USAGE_PATHS) {
      await expectNotFound(page, path);
    }
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
  test("lands on My usage, sees Usage (My usage only), Management and Administration, every link opens its page, no sync badge", async ({
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

    await expectSidebarAndWalk(page, [
      USAGE_MY_USAGE_ONLY,
      MANAGEMENT,
      ADMINISTRATION,
    ]);
  });

  test("every Usage route is a 404 (B1-2)", async ({ context, page }) => {
    await open(page, context, byName("member"), "/dashboard/me");

    for (const path of HIDDEN_USAGE_PATHS) {
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
});
