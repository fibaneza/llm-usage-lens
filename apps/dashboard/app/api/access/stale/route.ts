import { StaleAccessRowSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { accessErrorResponse, listOptions } from "@/lib/api/access-route";
import { loadReadableUnits, narrowToTeam } from "@/lib/api/pending-stale-route";
import { jsonData, jsonError, withRoute } from "@/lib/api/respond";
import { listStaleAccess } from "@/lib/data/access/pending-stale";

// Source: docs/specs/2026-11-10-access-control.md - "Membership, admin scopes
// and lifecycle" (Leaver: pending items unbound for more than 30 days;
// affiliations, admin scopes and in-app grants idle for more than 90 days, D2;
// D34), D37 (names for in-scope rows only), "Permission matrix", Enforcement
// items 2, 4 and 7, Rule 20.6.
export const GET = withRoute(async (request, _ctx, session) => {
  const readable = await loadReadableUnits(session);
  if (readable === null) {
    return jsonError(403, "FORBIDDEN", "Insufficient permission");
  }
  const units = narrowToTeam(readable, request);
  const result = await listStaleAccess(
    {
      teamIds: units.teamIds,
      departmentIds: units.departmentIds,
      membersOnly: units.membersOnly,
      roleGrants: units.configuration,
      now: new Date(),
    },
    listOptions(request),
  );
  if (!result.ok) return accessErrorResponse(result.code);
  return jsonData({
    items: z.array(StaleAccessRowSchema).parse(result.value.items),
    ...(result.value.cursor ? { cursor: result.value.cursor } : {}),
  });
});
