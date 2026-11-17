import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NAV_GROUPS,
  NAV_ITEMS,
  isNavItemActive,
  landingPathFor,
  navGroupsFor,
} from "./nav";
import type { ManagementNav, NavGroup, NavScope } from "./nav";

// Source: Design System - Navigation (Sidebar) (groups Usage / Management /
// Administration, rail labels, page titles, routes table, "hidden, never
// dead"); Access Control - Navigation and landing by role (the matrix;
// landing: global -> Cost overview, lead and user -> My usage); slice B1
// decisions B1-1 (Usage visibility = scope.global), B1-4 (landing), B1-5
// (groups and titles), B1-8 (navGroupsFor is the one filter); slice B2 brief
// B2-2 (the input gains the management flags, the LiteLLM item is gone,
// Management holds Team / Organisation / Users / Audit, Settings follows
// `settings`, a group with no item is not rendered), B2-1 (flags per role).
// Pure functions of the caller's resolved scope: no IO, so a unit test is the
// lowest layer that sees them.
//
// Contract: lib/nav.ts exports `ManagementNav` =
//   { team; organisation; users; audit; settings: boolean } and `NavScope`
//   gains an optional `management?: ManagementNav`. Absent flags mean false.
const NO_MANAGEMENT: ManagementNav = {
  team: false,
  organisation: false,
  users: false,
  audit: false,
  settings: false,
};
const scope = (over: Partial<NavScope> = {}): NavScope => ({
  global: false,
  memberTeamId: null,
  teamScopes: new Set<string>(),
  departmentScopes: new Set<string>(),
  management: NO_MANAGEMENT,
  ...over,
});

// Access Control matrix: admin everything; org admin all but Audit (neither
// audit source is readable by it); auditor everything read-only; lead only
// Team; user nothing.
const ADMIN_FLAGS: ManagementNav = {
  team: true,
  organisation: true,
  users: true,
  audit: true,
  settings: true,
};
const ORG_ADMIN_FLAGS: ManagementNav = { ...ADMIN_FLAGS, audit: false };
const LEAD_FLAGS: ManagementNav = { ...NO_MANAGEMENT, team: true };

// admin, org admin and auditor all resolve to a global scope (B1-1).
const GLOBAL = scope({ global: true, management: ADMIN_FLAGS });
const ORG_ADMIN = scope({ global: true, management: ORG_ADMIN_FLAGS });
const GLOBAL_WITH_ADMIN_SCOPES = scope({
  global: true,
  management: ADMIN_FLAGS,
  teamScopes: new Set(["team-a"]),
  departmentScopes: new Set(["dept-eng"]),
});
const LEAD_TEAMS = scope({
  teamScopes: new Set(["team-a", "team-b"]),
  management: LEAD_FLAGS,
});
const LEAD_DEPARTMENTS = scope({
  departmentScopes: new Set(["dept-eng"]),
  management: LEAD_FLAGS,
});
const LEAD_BOTH = scope({
  teamScopes: new Set(["team-a"]),
  departmentScopes: new Set(["dept-eng"]),
  management: LEAD_FLAGS,
});
const MEMBER = scope({ memberTeamId: "team-a" });
const NO_TEAM = scope();

type Projected = {
  label: string;
  items: { title: string; pageTitle: string; href: string }[];
}[];

const project = (groups: readonly NavGroup[]): Projected =>
  groups.map((g) => ({
    label: g.label,
    items: g.items.map(({ title, pageTitle, href }) => ({
      title,
      pageTitle,
      href,
    })),
  }));

const USAGE = {
  label: "Usage",
  items: [
    { title: "Overview", pageTitle: "Cost overview", href: "/dashboard" },
    {
      title: "Ranking",
      pageTitle: "Cost ranking",
      href: "/dashboard/ranking",
    },
    {
      title: "Cost by department",
      pageTitle: "Cost by department",
      href: "/dashboard/departments",
    },
    {
      title: "Cost by team",
      pageTitle: "Cost by team",
      href: "/dashboard/teams",
    },
    {
      title: "Cost by service",
      pageTitle: "Cost by service",
      href: "/dashboard/services",
    },
    {
      title: "Cost by user",
      pageTitle: "Cost by user",
      href: "/dashboard/users",
    },
    { title: "My usage", pageTitle: "My usage", href: "/dashboard/me" },
  ],
};
// Access Control B1-14 (2026-11-17): My usage is the last Usage item.
const USAGE_MY_USAGE_ONLY = {
  label: "Usage",
  items: [{ title: "My usage", pageTitle: "My usage", href: "/dashboard/me" }],
};
// Design System - Navigation (Sidebar), routes table (titles and hrefs).
const MGMT_TEAM = {
  title: "Team",
  pageTitle: "Team usage & management",
  href: "/dashboard/manage/team",
};
const MGMT_ORGANISATION = {
  title: "Organisation",
  pageTitle: "Organisation usage",
  href: "/dashboard/manage/organisation",
};
const MGMT_USERS = {
  title: "Users",
  pageTitle: "User lookup",
  href: "/dashboard/manage/users",
};
const MGMT_AUDIT = {
  title: "Audit",
  pageTitle: "Audit log",
  href: "/dashboard/manage/audit",
};
const MANAGEMENT_ALL = {
  label: "Management",
  items: [MGMT_TEAM, MGMT_ORGANISATION, MGMT_USERS, MGMT_AUDIT],
};
const MANAGEMENT_NO_AUDIT = {
  label: "Management",
  items: [MGMT_TEAM, MGMT_ORGANISATION, MGMT_USERS],
};
const MANAGEMENT_TEAM_ONLY = { label: "Management", items: [MGMT_TEAM] };
const ADMINISTRATION = {
  label: "Administration",
  items: [
    { title: "Settings", pageTitle: "Settings", href: "/dashboard/settings" },
  ],
};

const FULL_NAV: Projected = [USAGE, MANAGEMENT_ALL, ADMINISTRATION];

describe("navGroupsFor: per-role navigation (Access Control - Navigation and landing by role; B2-2)", () => {
  it.each([
    ["admin / auditor (every flag)", GLOBAL, FULL_NAV],
    [
      "a global reader who also holds admin scopes",
      GLOBAL_WITH_ADMIN_SCOPES,
      FULL_NAV,
    ],
    [
      "an org admin (no Audit: neither audit source is readable)",
      ORG_ADMIN,
      [USAGE, MANAGEMENT_NO_AUDIT, ADMINISTRATION],
    ],
  ])("%s sees the groups the matrix gives it, in order", (_n, s, expected) => {
    expect(project(navGroupsFor(s))).toEqual(expected);
  });

  // B2-2: a lead sees My usage and Team only; no Administration (B1-7
  // deferred the Settings gate to B2).
  it.each([
    ["a lead of teams", LEAD_TEAMS],
    ["a lead of departments", LEAD_DEPARTMENTS],
    ["a lead of both", LEAD_BOTH],
  ])("%s sees My usage and Team, and no Administration group", (_n, s) => {
    expect(project(navGroupsFor(s))).toEqual([
      USAGE_MY_USAGE_ONLY,
      MANAGEMENT_TEAM_ONLY,
    ]);
  });

  // "A group with no items is not rendered" (B2-2): a user holds My usage only.
  it.each([
    ["a member (user)", MEMBER],
    ["a viewer with no team (user)", NO_TEAM],
  ])("%s sees only the Usage group with My usage", (_n, s) => {
    expect(project(navGroupsFor(s))).toEqual([USAGE_MY_USAGE_ONLY]);
  });

  // Fail closed (B2-1 / B2-2): the flags are the only source of Management and
  // Settings; a nav input that carries none offers none, even when global.
  it("offers no Management item and no Settings when the input carries no management flags, even for a global scope", () => {
    const bare: NavScope = {
      global: true,
      memberTeamId: null,
      teamScopes: new Set<string>(),
      departmentScopes: new Set<string>(),
    };
    expect(project(navGroupsFor(bare))).toEqual([USAGE]);
  });

  it("each management flag controls exactly its own item", () => {
    const only = (key: keyof ManagementNav) =>
      navGroupsFor(
        scope({ global: true, management: { ...NO_MANAGEMENT, [key]: true } }),
      ).flatMap((g) => g.items.map((i) => i.href));
    const manage = (name: string) => `/dashboard/manage/${name}`;
    expect(only("team")).toContain(manage("team"));
    expect(only("organisation")).toContain(manage("organisation"));
    expect(only("users")).toContain(manage("users"));
    expect(only("audit")).toContain(manage("audit"));
    expect(only("settings")).toContain("/dashboard/settings");
    for (const key of ["team", "organisation", "users", "audit"] as const) {
      expect(only(key)).not.toContain("/dashboard/settings");
    }
    expect(only("settings")).not.toContain(manage("team"));
  });

  it("Settings is the only item of the last group (Administration) for a caller who may see it", () => {
    for (const s of [GLOBAL, ORG_ADMIN]) {
      const groups = navGroupsFor(s);
      const last = groups[groups.length - 1];
      expect(last?.label).toBe("Administration");
      expect(last?.items.map((i) => i.href)).toEqual(["/dashboard/settings"]);
    }
  });

  it("no caller is offered the retired LiteLLM item", () => {
    for (const s of [GLOBAL, ORG_ADMIN, LEAD_TEAMS, MEMBER, NO_TEAM]) {
      const hrefs = navGroupsFor(s).flatMap((g) => g.items.map((i) => i.href));
      expect(hrefs).not.toContain("/dashboard/litellm");
    }
    expect(NAV_ITEMS.map((i) => i.title)).not.toContain("LiteLLM");
  });

  it("never offers a group with no item for the caller (Design System: a group renders only when it has an item)", () => {
    for (const s of [
      GLOBAL,
      ORG_ADMIN,
      LEAD_TEAMS,
      LEAD_DEPARTMENTS,
      LEAD_BOTH,
      MEMBER,
      NO_TEAM,
    ]) {
      for (const group of navGroupsFor(s)) {
        expect(group.items.length).toBeGreaterThan(0);
      }
    }
  });

  // B1-5: the 4R.5 relabel and scoped Overview href are removed.
  it('carries no "My teams" relabel, no ?view=overview href and no pre-B1 group label for any caller', () => {
    const all = [
      GLOBAL,
      GLOBAL_WITH_ADMIN_SCOPES,
      LEAD_TEAMS,
      LEAD_DEPARTMENTS,
      MEMBER,
      NO_TEAM,
    ].flatMap((s) => navGroupsFor(s));
    for (const group of [...all, ...NAV_GROUPS]) {
      expect(["Main", "Attribution", "Gateway"]).not.toContain(group.label);
      for (const item of group.items) {
        expect(item.title).not.toBe("My teams");
        expect(item.href).not.toContain("view=overview");
        expect(item.href).not.toContain("?");
      }
    }
  });

  it("every offered href is a page that exists (no dead links)", () => {
    const hrefs = new Set(
      [GLOBAL, ORG_ADMIN, LEAD_TEAMS, MEMBER, NO_TEAM]
        .flatMap((s) => navGroupsFor(s))
        .flatMap((g) => g.items)
        .map((i) => i.href),
    );
    for (const href of hrefs) {
      const page = resolve(
        import.meta.dirname,
        "..",
        "app",
        href.replace(/^\//, ""),
        "page.tsx",
      );
      expect(existsSync(page), `${href} has no page.tsx`).toBe(true);
    }
  });
});

describe("NAV_GROUPS / NAV_ITEMS: the unfiltered full set (B1-8: no scope shows everything)", () => {
  it("is the full projection, so a bare render and an admin agree", () => {
    expect(project(NAV_GROUPS)).toEqual(FULL_NAV);
  });

  it("NAV_ITEMS flattens NAV_GROUPS, Settings and the Management pages included (PageTitle resolves every page from it)", () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(
      NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
    );
    expect(NAV_ITEMS).toContainEqual(
      expect.objectContaining({ title: "Settings", pageTitle: "Settings" }),
    );
    expect(NAV_ITEMS).toContainEqual(
      expect.objectContaining({
        title: "Audit",
        pageTitle: "Audit log",
        href: "/dashboard/manage/audit",
      }),
    );
  });

  it("page titles are unique so the top-bar h1 identifies one page", () => {
    const titles = NAV_ITEMS.map((i) => i.pageTitle);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("rail labels are unique within one sidebar (Design System: unique labels)", () => {
    const labels = NAV_ITEMS.map((i) => i.title);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("landingPathFor: role-aware landing (Access Control; B1-4)", () => {
  it.each([
    ["admin / org admin / auditor (global)", GLOBAL, "/dashboard"],
    [
      "a global reader who also holds admin scopes",
      GLOBAL_WITH_ADMIN_SCOPES,
      "/dashboard",
    ],
    ["a lead of teams", LEAD_TEAMS, "/dashboard/me"],
    ["a lead of one department", LEAD_DEPARTMENTS, "/dashboard/me"],
    [
      "a lead of several departments",
      scope({ departmentScopes: new Set(["dept-eng", "dept-ops"]) }),
      "/dashboard/me",
    ],
    ["a lead of departments and teams", LEAD_BOTH, "/dashboard/me"],
    [
      "a lead who is also a member",
      scope({ memberTeamId: "team-a", teamScopes: new Set(["team-a"]) }),
      "/dashboard/me",
    ],
    ["a member", MEMBER, "/dashboard/me"],
    ["a viewer with no team", NO_TEAM, "/dashboard/me"],
  ])("lands %s on the expected page", (_name, s, path) => {
    expect(landingPathFor(s)).toBe(path);
  });

  it("the landing page is always one the caller's nav offers (no landing on a hidden page)", () => {
    for (const s of [
      GLOBAL,
      ORG_ADMIN,
      LEAD_TEAMS,
      LEAD_DEPARTMENTS,
      MEMBER,
      NO_TEAM,
    ]) {
      const hrefs = navGroupsFor(s).flatMap((g) => g.items.map((i) => i.href));
      expect(hrefs).toContain(landingPathFor(s));
    }
  });
});

describe("isNavItemActive", () => {
  it("Overview owns only the exact /dashboard path", () => {
    expect(isNavItemActive("/dashboard", "/dashboard")).toBe(true);
    expect(isNavItemActive("/dashboard/me", "/dashboard")).toBe(false);
  });

  it("a nested detail route activates its list item (Cost by team on /dashboard/teams/<id>)", () => {
    expect(isNavItemActive("/dashboard/teams/team-1", "/dashboard/teams")).toBe(
      true,
    );
    expect(isNavItemActive("/dashboard/teams", "/dashboard/teams")).toBe(true);
    expect(isNavItemActive("/dashboard/teamsx", "/dashboard/teams")).toBe(
      false,
    );
  });

  // The Management routes live under /dashboard/manage/ so they never collide
  // with the Usage routes /dashboard/teams and /dashboard/users (Design System
  // - Navigation (Sidebar), routes): Cost by user must not light up on Users.
  it("a Management route does not activate the same-named Usage item", () => {
    expect(isNavItemActive("/dashboard/manage/users", "/dashboard/users")).toBe(
      false,
    );
    expect(
      isNavItemActive("/dashboard/manage/team", "/dashboard/manage/team"),
    ).toBe(true);
  });
});
