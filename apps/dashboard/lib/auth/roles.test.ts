import { describe, expect, it } from "vitest";

import {
  ADMIN_ROLE,
  GLOBAL_ROLES,
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  hasAdminRole,
  hasGlobalRole,
  resolveGlobalRoles,
  rolesFromProfile,
} from "@/lib/auth/roles";

// Source: docs/specs/2026-05-15-system-architecture.md — "Authentication &
// Access" → "Account-mutation role" (Entra app role value `Admin`, emitted in
// the ID token's `roles` claim, exposed as `session.user.roles`; role names and
// the check live in `auth.ts` and `lib/auth/` only, Rule 50.3); auth guide —
// App roles. Rule 60.22 (valid + invalid cases). The helpers are pure: no
// Auth.js, no env, no I/O.

// hasAdminRole accepts whatever Auth.js hands back (a Session or null); the
// invalid-shape cases below are deliberately outside that type.
const asSession = (value: unknown) =>
  value as Parameters<typeof hasAdminRole>[0];

describe("ADMIN_ROLE", () => {
  it("is the Entra app role value `Admin`", () => {
    expect(ADMIN_ROLE).toBe("Admin");
  });
});

describe("rolesFromProfile", () => {
  it("returns the string entries of the roles claim, in order", () => {
    expect(rolesFromProfile({ roles: ["Admin", "Reader"] })).toEqual([
      "Admin",
      "Reader",
    ]);
  });

  it("ignores other claims", () => {
    expect(
      rolesFromProfile({
        sub: "u1",
        name: "Ada",
        groups: ["group-id"],
        roles: ["Admin"],
      }),
    ).toEqual(["Admin"]);
  });

  it("returns [] for an empty roles array", () => {
    expect(rolesFromProfile({ roles: [] })).toEqual([]);
  });

  it("returns [] when the roles claim is absent", () => {
    expect(rolesFromProfile({ sub: "u1", name: "Ada" })).toEqual([]);
    expect(rolesFromProfile({})).toEqual([]);
  });

  it.each([
    ["a string", "Admin"],
    ["a number", 1],
    ["true", true],
    ["null", null],
    ["an object", { 0: "Admin", length: 1 }],
  ])("returns [] when the roles claim is %s (not an array)", (_name, roles) => {
    expect(rolesFromProfile({ roles })).toEqual([]);
  });

  it("drops non-string entries and keeps the strings", () => {
    expect(
      rolesFromProfile({
        roles: [
          "Admin",
          1,
          null,
          undefined,
          { name: "Admin" },
          ["Admin"],
          "Reader",
        ],
      }),
    ).toEqual(["Admin", "Reader"]);
  });

  it("returns [] when every entry is not a string", () => {
    expect(rolesFromProfile({ roles: [1, null, {}] })).toEqual([]);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "roles"],
    ["a number", 42],
    ["an array", ["Admin"]],
  ])("returns [] when the profile is %s", (_name, profile) => {
    expect(rolesFromProfile(profile)).toEqual([]);
  });

  it("does not mutate the profile it reads", () => {
    const roles = ["Admin", 1];
    const profile = { roles };
    rolesFromProfile(profile);
    expect(profile.roles).toBe(roles);
    expect(roles).toEqual(["Admin", 1]);
  });
});

describe("hasAdminRole", () => {
  it("is true when session.user.roles contains internal-admin", () => {
    expect(
      hasAdminRole(asSession({ user: { roles: ["internal-admin"] } })),
    ).toBe(true);
  });

  it("is true when Admin is one of several roles", () => {
    expect(
      hasAdminRole(
        asSession({
          user: { roles: ["internal-viewer", "internal-admin", "Other"] },
        }),
      ),
    ).toBe(true);
  });

  it("is false for a signed-in user with other roles only", () => {
    expect(hasAdminRole(asSession({ user: { roles: ["Reader"] } }))).toBe(
      false,
    );
  });

  it("is false for an empty roles array", () => {
    expect(hasAdminRole(asSession({ user: { roles: [] } }))).toBe(false);
  });

  it("is false when the session has no roles (e.g. a token from before roles existed)", () => {
    expect(
      hasAdminRole(asSession({ user: { name: "Ada", email: "a@x.test" } })),
    ).toBe(false);
  });

  it("is false when the session has no user", () => {
    expect(hasAdminRole(asSession({}))).toBe(false);
    expect(hasAdminRole(asSession({ user: undefined }))).toBe(false);
    expect(hasAdminRole(asSession({ user: null }))).toBe(false);
  });

  it("is false for a null session (unauthenticated)", () => {
    expect(hasAdminRole(null)).toBe(false);
  });

  it("is false for an undefined session", () => {
    expect(hasAdminRole(asSession(undefined))).toBe(false);
  });

  it.each([
    ["lower case", "Internal-Admin"],
    ["upper case", "INTERNAL-ADMIN"],
    ["a superstring", "internal-admin-x"],
    ["a substring", "internal-adm"],
    ["padded with whitespace", " internal-admin"],
    ["the legacy alias (resolved at sign-in, not at check time)", "Admin"],
  ])(
    "is false for a role that is only %s of Admin (exact match)",
    (_n, role) => {
      expect(hasAdminRole(asSession({ user: { roles: [role] } }))).toBe(false);
    },
  );

  it.each([
    ["the string 'internal-admin'", "internal-admin"],
    ["the string 'SuperAdmin'", "SuperAdmin"],
    ["an object keyed by index", { 0: "internal-admin" }],
    ["true", true],
    ["null", null],
  ])("is false when roles is %s instead of an array", (_name, roles) => {
    expect(hasAdminRole(asSession({ user: { roles } }))).toBe(false);
  });

  it("is false when the array holds Admin only as a non-string entry", () => {
    expect(
      hasAdminRole(
        asSession({
          user: { roles: [["internal-admin"], { name: "internal-admin" }] },
        }),
      ),
    ).toBe(false);
  });

  it("reads session.user.roles only, not a top-level roles field", () => {
    expect(
      hasAdminRole(
        asSession({ roles: ["internal-admin"], user: { name: "Ada" } }),
      ),
    ).toBe(false);
  });
});

// Source: docs/specs/2026-11-10-access-control.md — Roles; Identity, SSO
// mapping and defaults; Threat model T1 (fail closed on a malformed claim).
// Contract R1 decisions 1, 2, 10. Signature under test:
// resolveGlobalRoles(claim: unknown, appEnv: "dev" | "prod"): GlobalRole[] | null
// (null = claim present but not an array -> no session).

const session = (roles: unknown) =>
  ({ user: { roles } }) as Parameters<typeof hasAdminRole>[0];

describe("role constants", () => {
  it("defines exactly the four global roles", () => {
    expect([...GLOBAL_ROLES].sort()).toEqual(
      [
        "internal-admin",
        "internal-auditor",
        "internal-org-admin",
        "internal-viewer",
      ].sort(),
    );
    expect(INTERNAL_ADMIN_ROLE).toBe("internal-admin");
  });

  // Rule 50.3: role names live in lib/auth, never as literals in routes
  // (4R.4 slice-1 review warning: respond.ts used a literal).
  it("exports INTERNAL_AUDITOR_ROLE as one of the global roles", () => {
    expect(INTERNAL_AUDITOR_ROLE).toBe("internal-auditor");
    expect(GLOBAL_ROLES).toContain(INTERNAL_AUDITOR_ROLE);
  });
});

describe("resolveGlobalRoles", () => {
  it.each([
    ["absent", undefined],
    ["empty", []],
    ["only unknown values", ["Reader", "whatever"]],
    ["only non-strings", [1, null, {}]],
  ])("defaults to internal-viewer when the claim is %s", (_n, claim) => {
    expect(resolveGlobalRoles(claim, "dev")).toEqual(["internal-viewer"]);
  });

  it("keeps known global roles, drops unknown and non-string entries", () => {
    expect(resolveGlobalRoles(["internal-auditor", "nope", 7], "prod")).toEqual(
      ["internal-auditor"],
    );
  });

  it("de-duplicates", () => {
    expect(
      resolveGlobalRoles(["internal-admin", "internal-admin"], "prod"),
    ).toEqual(["internal-admin"]);
  });

  it("returns the union of several known roles", () => {
    const out = resolveGlobalRoles(
      ["internal-org-admin", "internal-auditor"],
      "prod",
    );
    expect(out).toEqual(
      expect.arrayContaining(["internal-org-admin", "internal-auditor"]),
    );
    expect(out).toHaveLength(2);
  });

  it("ignores internal-team-admin in a token (scoped roles come from data)", () => {
    expect(resolveGlobalRoles(["internal-team-admin"], "dev")).toEqual([
      "internal-viewer",
    ]);
    expect(
      resolveGlobalRoles(["internal-team-admin", "internal-auditor"], "dev"),
    ).toEqual(["internal-auditor"]);
  });

  it.each([
    ["a string", "internal-admin"],
    ["a number", 5],
    ["an object", {}],
    ["true", true],
    ["null", null],
  ])(
    "returns null (no session) when the claim is present but not an array: %s",
    (_n, claim) => {
      expect(resolveGlobalRoles(claim, "dev")).toBeNull();
    },
  );

  it("maps the legacy Admin role to internal-admin outside prod", () => {
    expect(resolveGlobalRoles(["Admin"], "dev")).toEqual(["internal-admin"]);
  });

  it("does not honour the legacy Admin alias when APP_ENV=prod", () => {
    expect(resolveGlobalRoles(["Admin"], "prod")).toEqual(["internal-viewer"]);
  });
});

describe("hasGlobalRole / hasAdminRole", () => {
  it("hasAdminRole is true only for internal-admin", () => {
    expect(hasAdminRole(session(["internal-admin"]))).toBe(true);
    for (const role of [
      "internal-auditor",
      "internal-org-admin",
      "internal-viewer",
    ]) {
      expect(hasAdminRole(session([role]))).toBe(false);
    }
  });

  it("hasAdminRole is false for malformed or missing sessions", () => {
    expect(hasAdminRole(null)).toBe(false);
    expect(hasAdminRole(undefined)).toBe(false);
    expect(hasAdminRole(session("internal-admin"))).toBe(false);
    expect(hasAdminRole(session(undefined))).toBe(false);
  });

  it("hasGlobalRole checks membership of a specific role", () => {
    expect(
      hasGlobalRole(session(["internal-auditor"]), "internal-auditor"),
    ).toBe(true);
    expect(
      hasGlobalRole(session(["internal-auditor"]), "internal-org-admin"),
    ).toBe(false);
    expect(hasGlobalRole(null, "internal-viewer")).toBe(false);
    expect(hasGlobalRole(session("internal-viewer"), "internal-viewer")).toBe(
      false,
    );
  });
});
