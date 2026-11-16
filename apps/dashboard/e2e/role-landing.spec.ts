import { expect, test, type Page } from "@playwright/test";

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

// Source: implementation-phases Phase 4R.5 (My usage /dashboard/me, My teams
// landing, scoped labels, "no team" state, role-aware landing, no dead links;
// Verify: "e2e per role; seeded probe per role"); Design System - "Access
// states and scoped labels" (Role-aware landing; No team: "Ask your team lead
// for access"; callers below internal-org-admin see "your teams"). The probe
// identities are seeded into DynamoDB Local by test/role-probe-seed.ts on top
// of `pnpm db:seed` (team-payments in dept-engineering); sessions are forged
// like every e2e session (e2e/support/session.ts, no auth bypass). Agent
// ruling 2026-11-16: every sign-in lands on /dashboard, whose server page
// redirects non-global callers to their landing unless ?view=overview.
// Idempotent puts: every worker may seed, none removes (a re-seed clears them).
test.beforeAll(seedRoleProbe);

const byName = (name: string): ProbeRole => {
  const role = PROBE_ROLES.find((r) => r.name === name);
  if (!role) throw new Error(`unknown probe role ${name}`);
  return role;
};

// Source: Design System - Role-aware landing; agent decision 2026-11-16: the
// landing is the Server Component /dashboard/home (4R.5 review: one row each).
const LANDINGS: [string, RegExp][] = [
  ["internal-admin", /\/dashboard(\?|$)/],
  ["internal-org-admin", /\/dashboard(\?|$)/],
  ["internal-auditor", /\/dashboard(\?|$)/],
  ["viewer-no-team", /\/dashboard\/me(\?|$)/],
  ["member", /\/dashboard\/me(\?|$)/],
  ["team-admin", /\/dashboard\/teams(\?|$)/],
  [
    "department-admin",
    new RegExp(`/dashboard/departments/${PROBE_DEPARTMENT}(\\?|$)`),
  ],
];

const HOME_LANDINGS: [string, RegExp][] = [
  ["internal-admin", /\/dashboard(\?|$)/],
  ["member", /\/dashboard\/me(\?|$)/],
  ["team-admin", /\/dashboard\/teams(\?|$)/],
];

async function open(
  page: Page,
  context: Parameters<typeof signInAsTestUser>[0],
  role: ProbeRole,
  path: string,
) {
  await signInAsTestUser(context, { oid: role.oid, roles: role.roles });
  await page.goto(path);
  await waitForHydration(page);
}

// The sidebar has no landmark role, so links are selected by role and exact
// name page-wide (Rule 60.24a; stricter for the absence checks: the link must
// be on no part of the page).
const sidebarLink = (page: Page, name: string | RegExp) =>
  page.getByRole("link", { name, exact: typeof name === "string" });

test.describe("role-aware landing (Design System: Role-aware landing)", () => {
  for (const [name, url] of LANDINGS) {
    test(`${name} lands on its own page after sign-in`, async ({
      context,
      page,
    }) => {
      await open(page, context, byName(name), "/dashboard");
      await expect(page).toHaveURL(url);
    });
  }
});

test.describe("/dashboard/home landing (Design System: Role-aware landing)", () => {
  for (const [name, url] of HOME_LANDINGS) {
    test(`${name} visiting /dashboard/home lands on its own page`, async ({
      context,
      page,
    }) => {
      await open(page, context, byName(name), "/dashboard/home");
      await expect(page).toHaveURL(url);
    });
  }
});

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
    for (const gone of [
      "Overview",
      "Ranking",
      "Teams",
      "My teams",
      "Departments",
    ]) {
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

test.describe("scoped navigation labels and no dead links", () => {
  for (const name of ["member", "team-admin", "department-admin"]) {
    test(`${name} sees "My teams", not "Teams", in the sidebar`, async ({
      context,
      page,
    }) => {
      await open(page, context, byName(name), "/dashboard/me");
      await expect(sidebarLink(page, "My teams")).toBeVisible();
      await expect(sidebarLink(page, "Teams")).toHaveCount(0);
    });
  }

  test("a global reader keeps the organisation-wide labels", async ({
    context,
    page,
  }) => {
    await open(page, context, byName("internal-org-admin"), "/dashboard");
    await expect(sidebarLink(page, "Teams")).toBeVisible();
    await expect(sidebarLink(page, "My teams")).toHaveCount(0);
  });

  test('a scoped caller reaches the Overview through the sidebar and sees "your teams"; a global reader does not', async ({
    context,
    page,
  }) => {
    await open(page, context, byName("team-admin"), "/dashboard");
    await expect(page).toHaveURL(/\/dashboard\/teams(\?|$)/);
    await sidebarLink(page, "Overview").click();
    await expect(page).toHaveURL(/\/dashboard\?(.*&)?view=overview/);
    await expect(page.getByText(/your teams/i).first()).toBeVisible();
    await signInAsTestUser(context, {
      oid: byName("internal-admin").oid,
      roles: ["internal-admin"],
    });
    await page.goto("/dashboard");
    await waitForHydration(page);
    await expect(page).toHaveURL(/\/dashboard(\?|$)/);
    await expect(page.getByText(/your teams/i)).toHaveCount(0);
  });

  for (const role of PROBE_ROLES) {
    test(`every sidebar link of ${role.name} opens a page (no dead links)`, async ({
      context,
      page,
    }) => {
      await open(page, context, role, "/dashboard");
      const hrefs = (
        await page.getByRole("link").evaluateAll((links) =>
          links.map((a) => {
            const l = a as HTMLAnchorElement;
            return l.pathname + l.search;
          }),
        )
      ).filter((href) => href.startsWith("/dashboard"));
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of [...new Set(hrefs)]) {
        const response = await page.goto(href);
        expect(response?.status(), href).toBeLessThan(400);
        await expect(
          page.getByText(/this page could not be found/i),
        ).toHaveCount(0);
      }
    });
  }

  test("a member's own team detail is reachable", async ({ context, page }) => {
    await open(
      page,
      context,
      byName("member"),
      `/dashboard/teams/${PROBE_TEAM}`,
    );
    await expect(page).toHaveURL(new RegExp(`/dashboard/teams/${PROBE_TEAM}`));
  });
});
