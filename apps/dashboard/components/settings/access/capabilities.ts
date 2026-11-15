import {
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
} from "@/lib/auth/roles";

// Source: docs/specs/2026-11-10-access-control.md - "Permission matrix" and
// "API routes (additions)"; design-system "Settings Page" (sections a caller
// cannot use are not rendered). Rule 50.3: role names stay in lib/auth. The
// write routes enforce every one of these again.
type ViewerInput = {
  roles: readonly string[];
  adminScopes: readonly {
    readonly scopeType: "team" | "department";
    readonly scopeId: string;
  }[];
};

export type SectionAccess = "edit" | "read" | "none";

export type AccessCapabilities = {
  members: boolean;
  teamAdmins: boolean;
  visibility: boolean;
  pendingAccess: boolean;
  moveMember: boolean;
  grantDepartmentAdmin: boolean;
  editDepartmentVisibility: boolean;
  groupMappings: SectionAccess;
  roleGrants: SectionAccess;
  identityLinks: SectionAccess;
  passwordUsers: SectionAccess;
  perUserApproval: SectionAccess;
  auditLog: boolean;
  accessReview: boolean;
};

export function accessCapabilities(viewer: ViewerInput): AccessCapabilities {
  const isAdmin = viewer.roles.includes(INTERNAL_ADMIN_ROLE);
  const isAuditor = viewer.roles.includes(INTERNAL_AUDITOR_ROLE);
  const matrixWriter =
    isAdmin || viewer.roles.includes(INTERNAL_ORG_ADMIN_ROLE);
  const teamScope = viewer.adminScopes.some((s) => s.scopeType === "team");
  const departmentScope = viewer.adminScopes.some(
    (s) => s.scopeType === "department",
  );
  const matrix = matrixWriter || teamScope || departmentScope;
  const configuration: SectionAccess = isAdmin
    ? "edit"
    : isAuditor
      ? "read"
      : "none";

  return {
    members: matrix,
    teamAdmins: matrix,
    visibility: matrix,
    // D34 (user, 2026-11-15): the managers and the auditor read the pending and
    // stale lists; the routes scope the rows.
    pendingAccess: matrix || isAuditor,
    moveMember: matrixWriter || departmentScope,
    grantDepartmentAdmin: matrixWriter,
    editDepartmentVisibility: matrixWriter || departmentScope,
    groupMappings: configuration,
    roleGrants: configuration,
    identityLinks: configuration,
    passwordUsers: configuration,
    perUserApproval: configuration,
    auditLog: isAdmin || isAuditor,
    accessReview: isAdmin || isAuditor,
  };
}
