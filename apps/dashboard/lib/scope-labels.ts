import type { NavScope } from "@/lib/nav";

// Source: Design System - Access states and scoped labels: callers below
// internal-org-admin see "your teams" on organisation-style views.
export function scopeNoticeFor(scope: NavScope): string | null {
  if (scope.global) return null;
  const scoped =
    scope.memberTeamId !== null ||
    scope.teamScopes.size > 0 ||
    scope.departmentScopes.size > 0;
  if (!scoped) return null;
  return "Showing your teams only.";
}
