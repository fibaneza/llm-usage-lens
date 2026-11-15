import { describe, expect, it } from "vitest";

import {
  GLOBAL_ROLES,
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  hasAdminRole,
  hasGlobalRole,
  resolveGlobalRoles,
} from "@/lib/auth/roles";

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
