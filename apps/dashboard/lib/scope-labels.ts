import type { NavScope } from "@/lib/nav";

// Source: Design System - Layout, Page frame and Access states and scoped
// labels: a `ScopeLine` states the scope; a caller who sees everything gets no
// line.
export function scopeLabelFor(scope: NavScope): string | null {
  if (scope.global) return null;
  if (scope.teamScopes.size > 0) return "Showing teams you lead";
  if (scope.departmentScopes.size > 0) return "Showing departments you lead";
  return "Showing your team";
}
