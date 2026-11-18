import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { matrixWrite } from "@/lib/api/matrix-route";
import { jsonData } from "@/lib/api/respond";
import {
  denyBudgetResetRequest,
  toRequestViews,
} from "@/lib/data/budget-reset-requests";
import { createNotifications } from "@/lib/data/notifications";

import { loadDecidable } from "../../decision";

// Source: docs/specs/2026-11-10-litellm.md — "Budget reset requests" (deny
// changes nothing in LiteLLM, so it re-checks neither link nor toggles);
// Access Control BR1, BR2, BR4.

export const dynamic = "force-dynamic";

const PATTERN = "/api/budget-reset-requests/[id]/deny";

export const POST = matrixWrite(
  {
    operation: "member",
    action: "budgetreset.request.deny",
    pattern: PATTERN,
  },
  async (args) => {
    const { session } = args;
    const decidable = await loadDecidable(args, {
      action: "budgetreset.request.deny",
      pattern: PATTERN,
    });
    if (decidable instanceof Response) return decidable;
    const { request } = decidable;

    const ctx = auditContext(session);
    const denied = await denyBudgetResetRequest(request, session.user.oid, ctx);
    if (!denied.ok) return accessErrorResponse(denied.code);
    await createNotifications(
      [
        {
          recipientOid: request.requesterOid,
          kind: "budget-reset.denied",
          requestId: request.requestId,
          teamId: request.teamId,
        },
      ],
      ctx.now,
    );
    const [view] = await toRequestViews([denied.value]);
    return jsonData({ request: view });
  },
);
