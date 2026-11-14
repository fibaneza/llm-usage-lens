import type {
  AdminScope,
  DepartmentVisibility,
  IdentityLink,
  MemberAffiliation,
  RoleGrant,
  TeamVisibility,
} from "@llm-usage-lens/shared";
import { describe, expect, it } from "vitest";

import { can, effectiveUserLevel, resolveScope } from "./policy";
import type { ResolveScopeInput } from "./policy";

// Source: docs/specs/2026-11-10-access-control.md — "Visibility and
// inheritance" (evaluation order, caps), "Membership, admin scopes and
// lifecycle" (department scope per day, W3), "Enforcement" item 1; threats
// T5, T6, T16; prompts/rbac_prompt.md section 3 (role x route callers).
// Assumed API (pure, no env/IO): resolveScope(ResolveScopeInput) -> Scope with
// `authenticated`; can(scope, "read", resource); effectiveUserLevel(scope,
// { teamId, departmentId }) -> "all" | "own" | "none".

const T = "2026-11-14T10:00:00.000Z";
const OID = "00000000-0000-4000-8000-000000000001";

const affiliation = (teamId: string): MemberAffiliation => ({
  oid: OID,
  teamId,
  source: "ui",
  version: 1,
  createdAt: T,
  updatedAt: T,
  createdBy: "x",
});
const adminScope = (
  scopeType: "team" | "department",
  scopeId: string,
  source: "ui" | "sso" = "ui",
): AdminScope => ({
  oid: OID,
  scopeType,
  scopeId,
  source,
  version: 1,
  createdAt: T,
  createdBy: "x",
});
const teamVis = (
  teamId: string,
  teamLevel: TeamVisibility["teamLevel"] = "visible",
  userLevel: TeamVisibility["userLevel"] = "own",
): TeamVisibility => ({
  teamId,
  teamLevel,
  userLevel,
  version: 1,
  updatedAt: T,
});
const deptVis = (
  departmentId: string,
  departmentLevel: DepartmentVisibility["departmentLevel"] = "hidden",
  maxUserLevel: DepartmentVisibility["maxUserLevel"] = "own",
): DepartmentVisibility => ({
  departmentId,
  departmentLevel,
  maxUserLevel,
  version: 1,
  updatedAt: T,
});

function input(over: Partial<ResolveScopeInput> = {}): ResolveScopeInput {
  return {
    appEnv: "dev",
    session: {
      user: { oid: OID, roles: ["internal-viewer"], email: "Jane@Company.com" },
    },
    affiliation: null,
    adminScopes: [],
    roleGrants: [],
    identity: null,
    identityLink: null,
    visibility: { teams: new Map(), departments: new Map() },
    perUserApproved: true,
    ...over,
  };
}
const withRoles = (roles: unknown, over: Partial<ResolveScopeInput> = {}) =>
  input({
    session: { user: { oid: OID, roles, email: "jane@company.com" } },
    ...over,
  });
const vis = (
  teams: TeamVisibility[] = [],
  depts: DepartmentVisibility[] = [],
) => ({
  teams: new Map(teams.map((t) => [t.teamId, t])),
  departments: new Map(depts.map((d) => [d.departmentId, d])),
});
const team = (teamId: string, departmentId = "dept-eng", date = "2026-10-01") =>
  ({ kind: "team", teamId, departmentId, date }) as const;
const dept = (departmentId: string) =>
  ({ kind: "department", departmentId }) as const;

describe("unauthenticated callers", () => {
  it.each([
    ["null session", null],
    ["no oid", { user: { roles: ["internal-admin"] } }],
    ["empty oid", { user: { oid: "", roles: ["internal-admin"] } }],
    ["roles not an array", { user: { oid: OID, roles: "internal-admin" } }],
  ])("%s reads nothing, not even own usage", (_n, session) => {
    const scope = resolveScope(input({ session }));
    expect(scope.authenticated).toBe(false);
    expect(can(scope, "read", team("team-a"))).toBe(false);
    expect(can(scope, "read", dept("dept-eng"))).toBe(false);
    expect(can(scope, "read", { kind: "own-usage" })).toBe(false);
  });
});

describe("internal-viewer without an affiliation (T5, T6)", () => {
  it.each([
    ["missing roles claim", undefined],
    ["empty roles", []],
    ["unknown roles only", ["Reader"]],
  ])("%s: no team or department data, own usage only", (_n, roles) => {
    const scope = resolveScope(
      withRoles(roles, {
        // Usage identities link a person to their own usage and grant no access.
        identityLink: {
          oid: OID,
          usageIdentities: ["jane@company.com"],
          aliases: ["jane-sso"],
          version: 1,
          updatedAt: T,
        } satisfies IdentityLink,
      }),
    );
    expect(scope.authenticated).toBe(true);
    expect(can(scope, "read", team("team-a"))).toBe(false);
    expect(can(scope, "read", dept("dept-eng"))).toBe(false);
    expect(
      can(scope, "read", {
        kind: "user-rows",
        teamId: "team-a",
        departmentId: "dept-eng",
      }),
    ).toBe(false);
    expect(can(scope, "read", { kind: "own-usage" })).toBe(true);
  });
});

describe("member affiliation", () => {
  const base = { affiliation: affiliation("team-a") };

  it("reads its own team only", () => {
    const scope = resolveScope(withRoles(["internal-viewer"], base));
    expect(can(scope, "read", team("team-a"))).toBe(true);
    expect(can(scope, "read", team("team-b"))).toBe(false);
  });

  it("team level hidden removes the team for its members", () => {
    const scope = resolveScope(
      withRoles(["internal-viewer"], {
        ...base,
        visibility: vis([teamVis("team-a", "hidden")]),
      }),
    );
    expect(can(scope, "read", team("team-a"))).toBe(false);
  });

  it("department totals are hidden by default and shown when visible", () => {
    const hidden = resolveScope(withRoles(["internal-viewer"], base));
    expect(can(hidden, "read", dept("dept-eng"))).toBe(false);
    const shown = resolveScope(
      withRoles(["internal-viewer"], {
        ...base,
        visibility: vis([], [deptVis("dept-eng", "visible")]),
      }),
    );
    expect(can(shown, "read", dept("dept-eng"))).toBe(true);
    expect(can(shown, "read", dept("dept-ops"))).toBe(false);
  });
});

describe("admin scopes", () => {
  it("a team scope reads its team even when team level is hidden, and no other", () => {
    const scope = resolveScope(
      withRoles(["internal-viewer"], {
        adminScopes: [adminScope("team", "team-a")],
        visibility: vis([teamVis("team-a", "hidden")]),
      }),
    );
    expect(can(scope, "read", team("team-a"))).toBe(true);
    expect(can(scope, "read", team("team-b"))).toBe(false);
    expect(can(scope, "read", dept("dept-eng"))).toBe(false);
  });

  it("several scopes each grant exactly their own team or department", () => {
    const scope = resolveScope(
      withRoles(["internal-viewer"], {
        adminScopes: [
          adminScope("team", "team-a"),
          adminScope("department", "dept-ops"),
        ],
      }),
    );
    expect(can(scope, "read", team("team-a"))).toBe(true);
    expect(can(scope, "read", team("team-c", "dept-ops"))).toBe(true);
    expect(can(scope, "read", team("team-b"))).toBe(false);
  });

  it("a department scope counts a team only on the days it names that department (W3)", () => {
    const scope = resolveScope(
      withRoles(["internal-viewer"], {
        adminScopes: [adminScope("department", "dept-eng")],
      }),
    );
    expect(can(scope, "read", team("team-m", "dept-eng", "2026-10-01"))).toBe(
      true,
    );
    expect(can(scope, "read", team("team-m", "dept-ops", "2026-10-03"))).toBe(
      false,
    );
    expect(can(scope, "read", team("team-c", "dept-ops"))).toBe(false);
    expect(can(scope, "read", dept("dept-eng"))).toBe(true);
    expect(can(scope, "read", dept("dept-ops"))).toBe(false);
  });

  it("SSO scopes are suspended during groups overage; UI scopes are not", () => {
    const sso = resolveScope(
      withRoles(["internal-viewer"], {
        adminScopes: [adminScope("team", "team-a", "sso")],
        identity: { groupsOverage: true },
      }),
    );
    expect(can(sso, "read", team("team-a"))).toBe(false);
    const ui = resolveScope(
      withRoles(["internal-viewer"], {
        adminScopes: [adminScope("team", "team-a", "ui")],
        identity: { groupsOverage: true },
      }),
    );
    expect(can(ui, "read", team("team-a"))).toBe(true);
    const ssoOk = resolveScope(
      withRoles(["internal-viewer"], {
        adminScopes: [adminScope("team", "team-a", "sso")],
        identity: { groupsOverage: false },
      }),
    );
    expect(can(ssoOk, "read", team("team-a"))).toBe(true);
  });
});

describe("global readers", () => {
  it.each([["internal-org-admin"], ["internal-auditor"], ["internal-admin"]])(
    "%s reads every team and department regardless of visibility",
    (role) => {
      const scope = resolveScope(
        withRoles([role], {
          visibility: vis(
            [teamVis("team-a", "hidden")],
            [deptVis("dept-eng", "hidden")],
          ),
        }),
      );
      expect(can(scope, "read", team("team-a"))).toBe(true);
      expect(can(scope, "read", team("team-z", "dept-z"))).toBe(true);
      expect(can(scope, "read", dept("dept-z"))).toBe(true);
    },
  );

  it("the master user (internal-admin, authMethod master) reads everything", () => {
    const scope = resolveScope(
      input({
        session: {
          user: {
            oid: "master:root",
            roles: ["internal-admin"],
            authMethod: "master",
          },
        },
      }),
    );
    expect(can(scope, "read", team("team-z", "dept-z"))).toBe(true);
  });

  it("an in-app role grant adds a global role to a viewer", () => {
    const grant: RoleGrant = {
      oid: OID,
      role: "internal-org-admin",
      reason: "r",
      grantedBy: "x",
      grantedAt: T,
      version: 1,
    };
    const scope = resolveScope(
      withRoles(["internal-viewer"], { roleGrants: [grant] }),
    );
    expect(can(scope, "read", team("team-z", "dept-z"))).toBe(true);
  });

  it("the legacy Admin alias works in dev and not in prod", () => {
    expect(
      can(resolveScope(withRoles(["Admin"])), "read", team("team-z")),
    ).toBe(true);
    expect(
      can(
        resolveScope(withRoles(["Admin"], { appEnv: "prod" })),
        "read",
        team("team-z"),
      ),
    ).toBe(false);
  });
});

describe("user level: min(organisation cap, department cap, team setting)", () => {
  const ref = { teamId: "team-a", departmentId: "dept-eng" };
  it.each([
    ["all", "all", "all"],
    ["all", "own", "own"],
    ["own", "all", "own"],
    ["none", "all", "none"],
    ["all", "none", "none"],
    ["own", "own", "own"],
  ] as const)(
    "team %s under department cap %s applies %s",
    (user, cap, expected) => {
      const scope = resolveScope(
        withRoles(["internal-viewer"], {
          affiliation: affiliation("team-a"),
          visibility: vis(
            [teamVis("team-a", "visible", user)],
            [deptVis("dept-eng", "hidden", cap)],
          ),
        }),
      );
      expect(effectiveUserLevel(scope, ref)).toBe(expected);
    },
  );

  it("own shows exactly the caller's rows through email and the identity link; none shows no per-user data", () => {
    const link: IdentityLink = {
      oid: OID,
      usageIdentities: ["jane.alt@company.com"],
      aliases: ["jane-sso"],
      version: 1,
      updatedAt: T,
    };
    const scope = resolveScope(
      withRoles(["internal-viewer"], {
        affiliation: affiliation("team-a"),
        identityLink: link,
        visibility: vis(
          [teamVis("team-a", "visible", "own")],
          [deptVis("dept-eng", "hidden", "all")],
        ),
      }),
    );
    const row = (usageKey: string) =>
      can(scope, "read", { kind: "user-row", ...ref, usageKey });
    expect(row("jane@company.com")).toBe(true);
    expect(row("jane.alt@company.com")).toBe(true);
    expect(row("jane-sso")).toBe(true);
    expect(row("other@company.com")).toBe(false);
    expect(can(scope, "read", { kind: "user-rows", ...ref })).toBe(false);

    const none = resolveScope(
      withRoles(["internal-viewer"], {
        affiliation: affiliation("team-a"),
        visibility: vis(
          [teamVis("team-a", "visible", "none")],
          [deptVis("dept-eng", "hidden", "all")],
        ),
      }),
    );
    expect(
      can(none, "read", {
        kind: "user-row",
        ...ref,
        usageKey: "jane@company.com",
      }),
    ).toBe(false);
    expect(can(none, "read", { kind: "own-usage" })).toBe(true);
  });

  it("a global reader sees all per-user rows once approved", () => {
    const scope = resolveScope(withRoles(["internal-admin"]));
    expect(effectiveUserLevel(scope, ref)).toBe("all");
    expect(can(scope, "read", { kind: "user-rows", ...ref })).toBe(true);
  });
});

describe("per-user approval gate (T16)", () => {
  const ref = { teamId: "team-a", departmentId: "dept-eng" };
  it.each(["internal-admin", "internal-org-admin", "internal-auditor"])(
    "in prod without approval %s is capped at own, with counts still readable",
    (role) => {
      const scope = resolveScope(
        withRoles([role], { appEnv: "prod", perUserApproved: false }),
      );
      expect(effectiveUserLevel(scope, ref)).toBe("own");
      expect(can(scope, "read", { kind: "user-rows", ...ref })).toBe(false);
      expect(
        can(scope, "read", { kind: "user-counts", ...ref, date: "2026-10-01" }),
      ).toBe(true);
      expect(can(scope, "read", { kind: "own-usage" })).toBe(true);
    },
  );

  it("a team admin is capped too", () => {
    const scope = resolveScope(
      withRoles(["internal-viewer"], {
        appEnv: "prod",
        perUserApproved: false,
        adminScopes: [adminScope("team", "team-a")],
        visibility: vis(
          [teamVis("team-a", "visible", "all")],
          [deptVis("dept-eng", "hidden", "all")],
        ),
      }),
    );
    expect(effectiveUserLevel(scope, ref)).toBe("own");
  });

  it("approval lifts the cap in prod; dev has no gate", () => {
    expect(
      effectiveUserLevel(
        resolveScope(
          withRoles(["internal-admin"], {
            appEnv: "prod",
            perUserApproved: true,
          }),
        ),
        ref,
      ),
    ).toBe("all");
    expect(
      effectiveUserLevel(
        resolveScope(
          withRoles(["internal-admin"], {
            appEnv: "dev",
            perUserApproved: false,
          }),
        ),
        ref,
      ),
    ).toBe("all");
  });
});
