import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NAV_GROUPS,
  NAV_ITEMS,
  SETTINGS_NAV_ITEM,
  landingPathFor,
  navGroupsFor,
} from "./nav";
import type { NavScope } from "./nav";
import { scopeNoticeFor } from "./scope-labels";

// Source: implementation-phases Phase 4R.5 (scoped labels, "no team" state,
// role-aware landing, no dead links); Design System - "Access states and
// scoped labels" (role-aware landing; callers below internal-org-admin see
// "your teams"); Access Control spec - Roles (internal-viewer default,
// admin scopes, member team). Pure functions of the caller's resolved scope
// (`/api/me`): no IO, so a unit test is the lowest layer that sees them.
const scope = (over: Partial<NavScope> = {}): NavScope => ({
  global: false,
  memberTeamId: null,
  teamScopes: new Set<string>(),
  departmentScopes: new Set<string>(),
  ...over,
});
const GLOBAL = scope({ global: true });
const NO_TEAM = scope();
const MEMBER = scope({ memberTeamId: "team-a" });
const TEAM_ADMIN = scope({ teamScopes: new Set(["team-a"]) });
const DEPT_ADMIN = scope({ departmentScopes: new Set(["dept-eng"]) });

const titles = (s: NavScope) =>
  navGroupsFor(s).flatMap((g) => g.items.map((i) => i.title));

describe("My usage navigation entry (Phase 4R.5: /dashboard/me)", () => {
  it("is a registered destination with its own page title", () => {
    expect(NAV_ITEMS).toContainEqual(
      expect.objectContaining({
        title: "My usage",
        pageTitle: "My usage",
        href: "/dashboard/me",
      }),
    );
  });

  it.each([
    ["global", GLOBAL],
    ["no team", NO_TEAM],
    ["member", MEMBER],
    ["team admin", TEAM_ADMIN],
    ["department admin", DEPT_ADMIN],
  ])(
    "is offered to a %s caller (Design System: My usage, all roles)",
    (_n, s) => {
      expect(titles(s)).toContain("My usage");
    },
  );
});

describe("navGroupsFor: no dead links (Phase 4R.5)", () => {
  it("a global reader sees every destination", () => {
    expect(titles(GLOBAL)).toEqual(
      expect.arrayContaining([
        "My usage",
        "Overview",
        "Ranking",
        "Departments",
        "Teams",
        "Services",
        "Users",
        "LiteLLM",
      ]),
    );
  });

  it("a viewer with no team sees My usage and the gateway page, not empty attribution pages (Design System: No team)", () => {
    const seen = titles(NO_TEAM);
    expect(seen).toEqual(expect.arrayContaining(["My usage", "LiteLLM"]));
    for (const gone of [
      "Overview",
      "Ranking",
      "Departments",
      "Teams",
      "Services",
      "Users",
    ]) {
      expect(seen).not.toContain(gone);
    }
  });

  it("a member sees the team views but not Departments (no department scope)", () => {
    const seen = titles(MEMBER);
    expect(seen).toEqual(
      expect.arrayContaining(["My usage", "Overview", "My teams", "Ranking"]),
    );
    expect(seen).not.toContain("Departments");
  });

  // Ruling 2026-11-16: sign-in always lands on /dashboard, which redirects a
  // non-global caller to their landing unless ?view=overview is present.
  it("a global reader's Overview link is /dashboard (the page never redirects them)", () => {
    const overview = navGroupsFor(GLOBAL)
      .flatMap((g) => g.items)
      .find((i) => i.title === "Overview");
    expect(overview?.href).toBe("/dashboard");
  });

  it.each([
    ["member", MEMBER],
    ["team admin", TEAM_ADMIN],
    ["department admin", DEPT_ADMIN],
  ])(
    "a %s's Overview link is /dashboard?view=overview (opts out of the landing redirect)",
    (_n, s) => {
      const overview = navGroupsFor(s)
        .flatMap((g) => g.items)
        .find((i) => i.title === "Overview");
      expect(overview?.href).toBe("/dashboard?view=overview");
    },
  );

  it("a department admin sees Departments", () => {
    expect(titles(DEPT_ADMIN)).toContain("Departments");
  });

  it.each([
    ["member", MEMBER],
    ["team admin", TEAM_ADMIN],
    ["department admin", DEPT_ADMIN],
  ])(
    'labels Teams "My teams" for a %s, "Teams" only for global readers ("your teams" labels)',
    (_n, s) => {
      expect(titles(s)).toContain("My teams");
      expect(titles(s)).not.toContain("Teams");
      expect(titles(GLOBAL)).toContain("Teams");
      expect(titles(GLOBAL)).not.toContain("My teams");
    },
  );

  it("every offered href is a page that exists (no dead links)", () => {
    const hrefs = new Set(
      [GLOBAL, NO_TEAM, MEMBER, TEAM_ADMIN, DEPT_ADMIN]
        .flatMap((s) => navGroupsFor(s))
        .flatMap((g) => g.items)
        .map((i) => i.href)
        .concat(SETTINGS_NAV_ITEM.href),
    );
    for (const href of hrefs) {
      const page = resolve(
        import.meta.dirname,
        "..",
        "app",
        (href.split("?")[0] ?? "").replace(/^\//, ""),
        "page.tsx",
      );
      expect(existsSync(page), `${href} has no page.tsx`).toBe(true);
    }
  });

  it("keeps NAV_GROUPS as the unfiltered full set the command menu and static fallback use", () => {
    const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.title));
    expect(all).toEqual(
      expect.arrayContaining(["My usage", "Overview", "Teams", "Departments"]),
    );
  });
});

describe("landingPathFor: role-aware landing (Design System; Phase 4R.5)", () => {
  it.each([
    ["internal-org-admin / admin / auditor (global)", GLOBAL, "/dashboard"],
    ["internal-viewer with no team", NO_TEAM, "/dashboard/me"],
    ["a member", MEMBER, "/dashboard/me"],
    ["a team admin (My teams)", TEAM_ADMIN, "/dashboard/teams"],
    [
      "a team admin who is also a member",
      scope({ memberTeamId: "team-a", teamScopes: new Set(["team-a"]) }),
      "/dashboard/teams",
    ],
    [
      "a department admin of one department (My department)",
      DEPT_ADMIN,
      "/dashboard/departments/dept-eng",
    ],
    [
      "a department admin of two departments",
      scope({ departmentScopes: new Set(["dept-eng", "dept-ops"]) }),
      "/dashboard/departments",
    ],
    [
      "a department and team admin (department wins)",
      scope({
        departmentScopes: new Set(["dept-eng"]),
        teamScopes: new Set(["team-z"]),
      }),
      "/dashboard/departments/dept-eng",
    ],
    [
      "a global reader who also holds admin scopes",
      scope({ global: true, teamScopes: new Set(["team-a"]) }),
      "/dashboard",
    ],
  ])("lands %s on %s", (_name, s, path) => {
    expect(landingPathFor(s)).toBe(path);
  });

  it("encodes a department id in the path", () => {
    expect(
      landingPathFor(scope({ departmentScopes: new Set(["a b/c"]) })),
    ).toBe("/dashboard/departments/a%20b%2Fc");
  });
});

describe("scopeNoticeFor: scoped labels", () => {
  it("is null for a global reader (organisation-wide views, no label)", () => {
    expect(scopeNoticeFor(GLOBAL)).toBeNull();
  });

  it.each([
    ["member", MEMBER],
    ["team admin", TEAM_ADMIN],
    ["department admin", DEPT_ADMIN],
  ])('says "your teams" for a %s (Design System: Scoped labels)', (_n, s) => {
    expect(scopeNoticeFor(s)).toMatch(/your teams/i);
  });
});
