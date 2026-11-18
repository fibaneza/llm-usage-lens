import type { MyBudgetResetRequests } from "@llm-usage-lens/shared";

import { loadManager } from "@/lib/api/matrix-route";
import { jsonData, withRoute } from "@/lib/api/respond";
import { getAffiliation } from "@/lib/data/access/affiliations";
import {
  getOpenRequestFor,
  listRecentRequestsFor,
  mayRequestBudgetReset,
  requestBudgetResetEnabled,
  toRequestViews,
} from "@/lib/data/budget-reset-requests";
import { getTeamLink } from "@/lib/data/litellm/team-links";
import { enabledOperations } from "@/lib/litellm/read-views";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes"
// (`/api/budget-reset-requests/mine`): any signed-in role, own data only;
// eligibility in the order no-team, not-linked, disabled, open-request.
// "Hidden, never dead": the control shows only when `canRequest` is true.

export const dynamic = "force-dynamic";

export const GET = withRoute(async (_request, _ctx, session) => {
  const oid = session.user.oid;
  const affiliation = await getAffiliation(oid);
  if (!affiliation) {
    const none: MyBudgetResetRequests = {
      teamId: null,
      eligibility: { canRequest: false, reason: "no-team" },
      open: null,
      recent: [],
    };
    return jsonData(none);
  }
  const teamId = affiliation.teamId;

  const [actor, link, requestsOn, operations, open, recent] = await Promise.all(
    [
      loadManager(session),
      getTeamLink(teamId),
      requestBudgetResetEnabled(),
      enabledOperations(),
      getOpenRequestFor(teamId, oid),
      listRecentRequestsFor(teamId, oid),
    ],
  );

  let reason: MyBudgetResetRequests["eligibility"]["reason"] = null;
  if (!mayRequestBudgetReset(actor)) reason = "no-team";
  else if (!link) reason = "not-linked";
  else if (!requestsOn || !operations.includes("resetMemberSpend")) {
    reason = "disabled";
  } else if (open) reason = "open-request";

  const views = await toRequestViews([...(open ? [open] : []), ...recent]);
  const openView = open ? (views[0] ?? null) : null;
  const data: MyBudgetResetRequests = {
    teamId,
    eligibility: { canRequest: reason === null, reason },
    open: openView,
    recent: open ? views.slice(1) : views,
  };
  return jsonData(data);
});
