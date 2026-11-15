import type { AccessViewer } from "@/components/settings/access/types";

// Test-only viewers for the Settings access sections (Access Control spec -
// Permission matrix). `adminScopes` is what the server resolved for the
// session (suspended SSO scopes already excluded).
const base = { authMethod: "entra" as const };

export const ADMIN: AccessViewer = {
  ...base,
  roles: ["internal-admin"],
  adminScopes: [],
};
export const ORG_ADMIN: AccessViewer = {
  ...base,
  roles: ["internal-org-admin"],
  adminScopes: [],
};
export const AUDITOR: AccessViewer = {
  ...base,
  roles: ["internal-auditor"],
  adminScopes: [],
};
export const TEAM_ADMIN: AccessViewer = {
  ...base,
  roles: ["internal-viewer"],
  adminScopes: [{ scopeType: "team", scopeId: "team-pay" }],
};
export const DEPT_ADMIN: AccessViewer = {
  ...base,
  roles: ["internal-viewer"],
  adminScopes: [{ scopeType: "department", scopeId: "dept-eng" }],
};
export const PLAIN_VIEWER: AccessViewer = {
  ...base,
  roles: ["internal-viewer"],
  adminScopes: [],
};
