import {
  MarkNotificationsReadInputSchema,
  MarkNotificationsReadResponseSchema,
} from "@llm-usage-lens/shared";

import { jsonData, parseJsonBody, withRoute } from "@/lib/api/respond";
import { markNotificationsRead } from "@/lib/data/notifications";

// Source: docs/specs/2026-05-15-data-model.md — API Routes
// (`/api/notifications/read`): own state only, keys built from the session
// oid, any signed-in role, not audited.
export const dynamic = "force-dynamic";

export const POST = withRoute(async (request, _ctx, session) => {
  const body = await parseJsonBody(request, MarkNotificationsReadInputSchema);
  const updated = await markNotificationsRead(
    session.user.oid,
    body,
    new Date(),
  );
  return jsonData(MarkNotificationsReadResponseSchema.parse({ updated }));
});
