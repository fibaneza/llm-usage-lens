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
import type { NavGroup, NavScope } from "./nav";

// Source: Design System - Navigation (Sidebar) (groups Usage / Management /
// Administration, rail labels, page titles, "hidden, never dead");
// Access Control - Navigation and landing by role (landing: global ->
// Cost overview, lead and user -> My usage); slice B1 brief decisions
// B1-1 (Usage visibility = scope.global), B1-4 (landing), B1-5 (groups and
// titles), B1-6 (Management in B1), B1-7 (Settings for every caller until B2),
// B1-8 (navGroupsFor is the one filter). Pure functions of the caller's
// resolved scope: no IO, so a unit test is the lowest layer that sees them.
const scope = (over: Partial<NavScope> = {}): NavScope => ({
  global: false,
  memberTeamId: null,
  teamScopes: new Set<string>(),
  departmentScopes: new Set<string>(),
  ...over,
});

// admin, org admin and auditor all resolve to a global scope (B1-1).
const GLOBAL = scope({ global: true });
const GLOBAL_WITH_ADMIN_SCOPES = scope({
  global: true,
  teamScopes: new Set(["team-a"]),
  departmentScopes: new Set(["dept-eng"]),
});
const LEAD_TEAMS = scope({ teamScopes: new Set(["team-a", "team-b"]) });
const LEAD_DEPARTMENTS = scope({ departmentScopes: new Set(["dept-eng"]) });
const LEAD_BOTH = scope({
  teamScopes: new Set(["team-a"]),
  departmentScopes: new Set(["dept-eng"]),
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
const MANAGEMENT = {
  label: "Management",
  items: [
    {
      title: "LiteLLM",
      pageTitle: "LiteLLM usage & administration",
      href: "/dashboard/litellm",
    },
  ],
};
const ADMINISTRATION = {
  label: "Administration",
  items: [
    { title: "Settings", pageTitle: "Settings", href: "/dashboard/settings" },
  ],
};

const GLOBAL_NAV: Projected = [USAGE, MANAGEMENT, ADMINISTRATION];
const NON_GLOBAL_NAV: Projected = [
  USAGE_MY_USAGE_ONLY,
  MANAGEMENT,
  ADMINISTRATION,
];

describe("navGroupsFor: per-role navigation (Access Control - Navigation and landing by role)", () => {
  it.each([
    ["admin / org admin / auditor (global)", GLOBAL],
    ["a global reader who also holds admin scopes", GLOBAL_WITH_ADMIN_SCOPES],
  ])("%s sees Usage, Management and Administration, in that order", (_n, s) => {
    expect(project(navGroupsFor(s))).toEqual(GLOBAL_NAV);
  });

  // B1-1 / B1-14: the six organisation-level Usage items are global-only; a
  // non-global caller's Usage group holds only My usage.
  it.each([
    ["a lead of teams", LEAD_TEAMS],
    ["a lead of departments", LEAD_DEPARTMENTS],
    ["a lead of both", LEAD_BOTH],
    ["a member (user)", MEMBER],
    ["a viewer with no team (user)", NO_TEAM],
  ])(
    "%s sees Usage (My usage only), Management (LiteLLM) and Administration (Settings)",
    (_n, s) => {
      expect(project(navGroupsFor(s))).toEqual(NON_GLOBAL_NAV);
    },
  );

  // B1-7: Settings is shown to every signed-in caller in B1 (B2 gates it).
  it.each([
    ["global", GLOBAL],
    ["lead", LEAD_TEAMS],
    ["member", MEMBER],
    ["no team", NO_TEAM],
  ])("Settings is the last item of the last group for a %s caller", (_n, s) => {
    const groups = navGroupsFor(s);
    const last = groups[groups.length - 1];
    expect(last?.label).toBe("Administration");
    expect(last?.items.map((i) => i.href)).toEqual(["/dashboard/settings"]);
  });

  it.each([
    ["global", GLOBAL],
    ["lead", LEAD_TEAMS],
    ["member", MEMBER],
    ["no team", NO_TEAM],
  ])("My usage and LiteLLM are offered to a %s caller (B1-6)", (_n, s) => {
    const hrefs = navGroupsFor(s).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual(
      expect.arrayContaining(["/dashboard/me", "/dashboard/litellm"]),
    );
  });

  it("never offers a group with no item for the caller (Design System: a group renders only when it has an item)", () => {
    for (const s of [
      GLOBAL,
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
      [GLOBAL, LEAD_TEAMS, MEMBER, NO_TEAM]
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
  it("is the global projection, so a bare render and a global caller agree", () => {
    expect(project(NAV_GROUPS)).toEqual(GLOBAL_NAV);
  });

  it("NAV_ITEMS flattens NAV_GROUPS, Settings included (PageTitle resolves every page from it)", () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(
      NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
    );
    expect(NAV_ITEMS).toContainEqual(
      expect.objectContaining({ title: "Settings", pageTitle: "Settings" }),
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
    for (const s of [GLOBAL, LEAD_TEAMS, LEAD_DEPARTMENTS, MEMBER, NO_TEAM]) {
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
});
