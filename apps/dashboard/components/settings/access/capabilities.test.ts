import { describe, expect, it } from "vitest";

import { accessCapabilities, canAcceptInvite } from "./capabilities";

// Source: docs/specs/2026-11-10-access-control.md - "Permission matrix"
// (which role edits which action), "API routes (additions)" (GET also
// internal-auditor on the admin-only reads), design-system "Settings Page"
// ("Sections a caller cannot use are not rendered"). Rule 50.3: role names stay
// in lib/auth; this pure function is what the Settings UI asks.
//
// Module under test: `components/settings/access/capabilities.ts`
//   accessCapabilities({ roles, adminScopes }) -> flags per section.
// "edit" = shown with write controls, "read" = shown read-only (auditor),
// "none" = not rendered.
// 4R.4 user decision 2026-11-15 (D34 reversed): `pendingAccess` shows the
// pending and stale lists to everyone who manages members (the matrix
// sections) and to the auditor (read-only, the quarterly access review),
// scoped on the server.
const TEAM_SCOPE = [{ scopeType: "team", scopeId: "team-pay" }] as const;
const DEPT_SCOPE = [{ scopeType: "department", scopeId: "dept-eng" }] as const;

describe("accessCapabilities", () => {
  it("internal-admin: every section, all writes", () => {
    expect(
      accessCapabilities({ roles: ["internal-admin"], adminScopes: [] }),
    ).toEqual({
      members: true,
      teamAdmins: true,
      visibility: true,
      pendingAccess: true,
      moveMember: true,
      grantDepartmentAdmin: true,
      editDepartmentVisibility: true,
      groupMappings: "edit",
      roleGrants: "edit",
      identityLinks: "edit",
      passwordUsers: "edit",
      perUserApproval: "edit",
      auditLog: true,
      accessReview: true,
    });
  });

  it("internal-org-admin: the matrix sections only, no configuration sections", () => {
    expect(
      accessCapabilities({ roles: ["internal-org-admin"], adminScopes: [] }),
    ).toEqual({
      members: true,
      teamAdmins: true,
      visibility: true,
      pendingAccess: true,
      moveMember: true,
      grantDepartmentAdmin: true,
      editDepartmentVisibility: true,
      groupMappings: "none",
      roleGrants: "none",
      identityLinks: "none",
      passwordUsers: "none",
      perUserApproval: "none",
      auditLog: false,
      accessReview: false,
    });
  });

  it("internal-auditor: read-only configuration sections, audit log and access review, no matrix sections", () => {
    expect(
      accessCapabilities({ roles: ["internal-auditor"], adminScopes: [] }),
    ).toEqual({
      members: false,
      teamAdmins: false,
      visibility: false,
      pendingAccess: true,
      moveMember: false,
      grantDepartmentAdmin: false,
      editDepartmentVisibility: false,
      groupMappings: "read",
      roleGrants: "read",
      identityLinks: "read",
      passwordUsers: "read",
      perUserApproval: "read",
      auditLog: true,
      accessReview: true,
    });
  });

  it("a team-scope admin (viewer role): matrix sections, but no move, no department admins, no department visibility", () => {
    const caps = accessCapabilities({
      roles: ["internal-viewer"],
      adminScopes: TEAM_SCOPE,
    });
    expect(caps).toMatchObject({
      members: true,
      teamAdmins: true,
      visibility: true,
      pendingAccess: true,
      moveMember: false,
      grantDepartmentAdmin: false,
      editDepartmentVisibility: false,
      groupMappings: "none",
      auditLog: false,
    });
  });

  it("a department-scope admin may move members and edit the department's visibility, but not grant department admins", () => {
    expect(
      accessCapabilities({
        roles: ["internal-viewer"],
        adminScopes: DEPT_SCOPE,
      }),
    ).toMatchObject({
      members: true,
      teamAdmins: true,
      visibility: true,
      pendingAccess: true,
      moveMember: true,
      grantDepartmentAdmin: false,
      editDepartmentVisibility: true,
    });
  });

  it("a plain viewer, no roles, or unknown roles see nothing", () => {
    for (const roles of [["internal-viewer"], [], ["Reader"]]) {
      const caps = accessCapabilities({ roles, adminScopes: [] });
      expect(
        caps.members ||
          caps.teamAdmins ||
          caps.visibility ||
          caps.pendingAccess,
      ).toBe(false);
      expect(caps).toMatchObject({
        groupMappings: "none",
        roleGrants: "none",
        identityLinks: "none",
        passwordUsers: "none",
        perUserApproval: "none",
        auditLog: false,
        accessReview: false,
      });
    }
  });

  it("an auditor who also holds an admin scope gets both sets, still read-only on configuration", () => {
    expect(
      accessCapabilities({
        roles: ["internal-auditor"],
        adminScopes: TEAM_SCOPE,
      }),
    ).toMatchObject({
      members: true,
      groupMappings: "read",
      roleGrants: "read",
      auditLog: true,
    });
  });
});

// Source: Access Control - permission matrix row "Accept a pending invite"
// (unit INV1): admin and org-admin any team; a lead or department admin for
// teams in scope; others never. The route enforces it again (T-INV5).
// Module under test: canAcceptInvite(viewer, { id, departmentId }) -> boolean
describe("canAcceptInvite", () => {
  const pay = { id: "team-pay", departmentId: "dept-eng" };
  const risk = { id: "team-risk", departmentId: "dept-fin" };
  it.each([
    ["internal-admin", ["internal-admin"], [], pay, true],
    ["internal-org-admin", ["internal-org-admin"], [], risk, true],
    ["team scope, in scope", ["internal-viewer"], TEAM_SCOPE, pay, true],
    ["team scope, other team", ["internal-viewer"], TEAM_SCOPE, risk, false],
    [
      "department scope, own department",
      ["internal-viewer"],
      DEPT_SCOPE,
      pay,
      true,
    ],
    [
      "department scope, other department",
      ["internal-viewer"],
      DEPT_SCOPE,
      risk,
      false,
    ],
    ["internal-auditor", ["internal-auditor"], [], pay, false],
    ["internal-viewer", ["internal-viewer"], [], pay, false],
  ])("%s", (_name, roles, adminScopes, team, expected) => {
    expect(
      canAcceptInvite({ roles, adminScopes: [...adminScopes] }, team),
    ).toBe(expected);
  });
});
