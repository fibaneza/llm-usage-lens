import { OrgUnitsSchema } from "@llm-usage-lens/shared";
import type { OrgUnits } from "@llm-usage-lens/shared";

import { loadManager } from "@/lib/api/matrix-route";
import { jsonData, jsonError, withRoute } from "@/lib/api/respond";
import { getAllAccountsCached } from "@/lib/api/cached-reads";
import { isMatrixWriter } from "@/lib/auth/write-policy";
import { INTERNAL_AUDITOR_ROLE } from "@/lib/auth/roles";

// Source: temp/run-r4b/decisions.md F10; docs/specs/2026-11-10-access-control.md
// - "Permission matrix" (a team-scope admin manages its team, a
// department-scope admin its department and that department's teams;
// internal-admin, internal-org-admin and, read-only, internal-auditor see the
// whole organisation). The lists come from the AccountMeta registry, so a team
// with no recent usage is included. The registry is organisation data and may
// be cached; the caller's scopes are read per request (Rule 60.10).
export const GET = withRoute(async (_request, _ctx, session) => {
  const actor = await loadManager(session);
  const global =
    actor !== null &&
    (isMatrixWriter(actor.roles) ||
      actor.roles.includes(INTERNAL_AUDITOR_ROLE));
  if (
    actor === null ||
    (!global &&
      actor.teamScopes.size === 0 &&
      actor.departmentScopes.size === 0)
  ) {
    return jsonError(403, "FORBIDDEN", "Insufficient permission");
  }

  const teams = new Map<string, OrgUnits["teams"][number]>();
  const departments = new Map<string, OrgUnits["departments"][number]>();
  for (const account of await getAllAccountsCached()) {
    const teamVisible =
      global ||
      actor.teamScopes.has(account.teamId) ||
      actor.departmentScopes.has(account.departmentId);
    if (teamVisible && !teams.has(account.teamId)) {
      teams.set(account.teamId, {
        id: account.teamId,
        name: account.teamName,
        departmentId: account.departmentId,
      });
    }
    if (
      (global || actor.departmentScopes.has(account.departmentId)) &&
      !departments.has(account.departmentId)
    ) {
      departments.set(account.departmentId, {
        id: account.departmentId,
        name: account.departmentName,
      });
    }
  }
  return jsonData(
    OrgUnitsSchema.parse({
      teams: [...teams.values()],
      departments: [...departments.values()],
    }),
  );
});
