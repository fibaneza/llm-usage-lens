import "server-only";

import type { Session } from "next-auth";

import { getAllAccountsCached } from "@/lib/api/cached-reads";
import { loadManager } from "@/lib/api/matrix-route";
import { INTERNAL_ADMIN_ROLE, INTERNAL_AUDITOR_ROLE } from "@/lib/auth/roles";
import { isMatrixWriter } from "@/lib/auth/write-policy";
import type { ReadableUnits } from "@/lib/data/access/pending-stale";

// Source: docs/specs/2026-11-10-access-control.md - "Permission matrix"
// (management reads: a team-scope admin reads its team, a department-scope
// admin its department and that department's teams; internal-admin,
// internal-org-admin and internal-auditor read all), "Membership, admin scopes
// and lifecycle" (D34), Enforcement item 4 (the caller's scopes are read per
// request; the registry is organisation data and may be cached, Rule 60.10).
// Null when the caller manages nothing: the route answers 403.
export async function loadReadableUnits(
  session: Session,
): Promise<(ReadableUnits & { configuration: boolean }) | null> {
  const actor = await loadManager(session);
  if (actor === null) return null;
  const global =
    isMatrixWriter(actor.roles) || actor.roles.includes(INTERNAL_AUDITOR_ROLE);
  if (
    !global &&
    actor.teamScopes.size === 0 &&
    actor.departmentScopes.size === 0
  ) {
    return null;
  }
  const accounts = await getAllAccountsCached();
  const teamIds = new Set<string>();
  const departmentIds = new Set<string>();
  for (const account of accounts) {
    if (
      global ||
      actor.teamScopes.has(account.teamId) ||
      actor.departmentScopes.has(account.departmentId)
    ) {
      teamIds.add(account.teamId);
    }
    if (global || actor.departmentScopes.has(account.departmentId)) {
      departmentIds.add(account.departmentId);
    }
  }
  return {
    teamIds: [...teamIds],
    departmentIds: [...departmentIds],
    // In-app role grants are configuration: internal-admin and
    // internal-auditor only.
    configuration:
      actor.roles.includes(INTERNAL_ADMIN_ROLE) ||
      actor.roles.includes(INTERNAL_AUDITOR_ROLE),
  };
}
