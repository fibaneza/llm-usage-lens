import { describe, expect, it } from "vitest";

import { ADMIN_ROLE, hasAdminRole, rolesFromProfile } from "@/lib/auth/roles";

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
  it("is true when session.user.roles contains Admin", () => {
    expect(hasAdminRole(asSession({ user: { roles: ["Admin"] } }))).toBe(true);
  });

  it("is true when Admin is one of several roles", () => {
    expect(
      hasAdminRole(
        asSession({ user: { roles: ["Reader", "Admin", "Other"] } }),
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
    ["lower case", "admin"],
    ["upper case", "ADMIN"],
    ["a superstring", "SuperAdmin"],
    ["a substring", "Adm"],
    ["padded with whitespace", " Admin"],
  ])(
    "is false for a role that is only %s of Admin (exact match)",
    (_n, role) => {
      expect(hasAdminRole(asSession({ user: { roles: [role] } }))).toBe(false);
    },
  );

  it.each([
    ["the string 'Admin'", "Admin"],
    ["the string 'SuperAdmin'", "SuperAdmin"],
    ["an object keyed by index", { 0: "Admin" }],
    ["true", true],
    ["null", null],
  ])("is false when roles is %s instead of an array", (_name, roles) => {
    expect(hasAdminRole(asSession({ user: { roles } }))).toBe(false);
  });

  it("is false when the array holds Admin only as a non-string entry", () => {
    expect(
      hasAdminRole(
        asSession({ user: { roles: [["Admin"], { name: "Admin" }] } }),
      ),
    ).toBe(false);
  });

  it("reads session.user.roles only, not a top-level roles field", () => {
    expect(
      hasAdminRole(asSession({ roles: ["Admin"], user: { name: "Ada" } })),
    ).toBe(false);
  });
});
