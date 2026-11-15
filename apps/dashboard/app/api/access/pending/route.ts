import { PendingItemSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { accessErrorResponse, listOptions } from "@/lib/api/access-route";
import { loadReadableUnits } from "@/lib/api/pending-stale-route";
import { jsonData, jsonError, withRoute } from "@/lib/api/respond";
import { listPendingAccess } from "@/lib/data/access/pending-stale";

// Source: docs/specs/2026-11-10-access-control.md - "Membership, admin scopes
// and lifecycle" (Joiner: pending items grant nothing until bound; D34),
// "Permission matrix" (the management-read rule), Enforcement items 2, 4 and 7
// (no-store, read per request, a read writes no audit record), Rule 20.6.
export const GET = withRoute(async (request, _ctx, session) => {
  const units = await loadReadableUnits(session);
  if (units === null) {
    return jsonError(403, "FORBIDDEN", "Insufficient permission");
  }
  const result = await listPendingAccess(units, listOptions(request));
  if (!result.ok) return accessErrorResponse(result.code);
  return jsonData({
    items: z.array(PendingItemSchema).parse(result.value.items),
    ...(result.value.cursor ? { cursor: result.value.cursor } : {}),
  });
});
