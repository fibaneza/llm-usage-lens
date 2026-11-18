import {
  BudgetResetRequestListQuerySchema,
  CreateBudgetResetRequestInputSchema,
} from "@llm-usage-lens/shared";

import {
  accessErrorResponse,
  auditContext,
  cursorSecret,
} from "@/lib/api/access-route";
import { loadManager } from "@/lib/api/matrix-route";
import {
  NOT_FOUND_MESSAGE,
  jsonData,
  jsonError,
  parseJsonBody,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { scopeFor } from "@/lib/api/scoped-rollups";
import { can } from "@/lib/auth/policy";
import { getAffiliation } from "@/lib/data/access/affiliations";
import { getAllAccounts } from "@/lib/data/account-meta";
import {
  createBudgetResetRequest,
  listTeamBudgetResetRequests,
  mayDecideTeam,
  mayRequestBudgetReset,
  requestBudgetResetEnabled,
  toRequestViews,
} from "@/lib/data/budget-reset-requests";
import { resolveResetRecipients } from "@/lib/data/budget-reset-requests-recipients";
import { getTeamLink } from "@/lib/data/litellm/team-links";
import { createNotifications } from "@/lib/data/notifications";
import { enabledOperations, requireEnabled } from "@/lib/litellm/read-views";
import {
  liteLLMErrorResponse,
  openModeRefusal,
} from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes" (budget reset
// requests); docs/specs/2026-11-10-litellm.md — "Budget reset requests",
// MG-D11 to MG-D13; Access Control — "Permission matrix", BR6, BR7.

export const dynamic = "force-dynamic";

const notFound = () => jsonError(404, "NOT_FOUND", NOT_FOUND_MESSAGE);

// The caller's member team, read once in `permit` and reused by the handler.
const memberTeams = new WeakMap<Request, string>();

export const POST = withRoute(
  async (request, _ctx, session) => {
    const refused = openModeRefusal();
    if (refused) return refused;

    const body = await parseJsonBody(
      request,
      CreateBudgetResetRequestInputSchema,
    );
    const teamId = memberTeams.get(request);
    if (!teamId) throw new Error("request reached without a member team");
    const meta = (await getAllAccounts()).find((a) => a.teamId === teamId);
    if (!meta) return notFound();

    const link = await getTeamLink(teamId);
    if (!link) {
      return jsonError(409, "CONFLICT", "The team is not connected to LiteLLM");
    }
    if (!(await requestBudgetResetEnabled())) {
      return jsonError(
        403,
        "OPERATION_DISABLED",
        "Budget reset requests are switched off",
      );
    }
    try {
      requireEnabled(await enabledOperations(), ["resetMemberSpend"]);
    } catch (error) {
      const response = liteLLMErrorResponse(error);
      if (response) return response;
      throw error;
    }

    const ctx = auditContext(session);
    const created = await createBudgetResetRequest(
      {
        requesterOid: session.user.oid,
        teamId,
        departmentId: meta.departmentId,
        litellmTeamId: link.litellmTeamId,
        reason: body.reason ?? null,
      },
      ctx,
    );
    if (!created.ok) return accessErrorResponse(created.code);

    const recipients = await resolveResetRecipients({
      teamId,
      departmentId: meta.departmentId,
      requesterOid: session.user.oid,
      cursorSecret: cursorSecret(),
    });
    await createNotifications(
      recipients.map((recipientOid) => ({
        recipientOid,
        kind: "budget-reset.requested" as const,
        requestId: created.value.requestId,
        teamId,
      })),
      ctx.now,
    );

    const [view] = await toRequestViews([created.value]);
    return jsonData(view, { status: 201 });
  },
  {
    // The requester is the caller's own member affiliation, never a body
    // field; a caller with none, or an auditor, is refused before parsing.
    permit: async (request, session) => {
      const [affiliation, actor] = await Promise.all([
        getAffiliation(session.user.oid),
        loadManager(session),
      ]);
      if (!affiliation || !mayRequestBudgetReset(actor)) return false;
      memberTeams.set(request, affiliation.teamId);
      return true;
    },
    denied: {
      action: "budgetreset.request.create",
      pattern: "/api/budget-reset-requests",
    },
  },
);

export const GET = withRoute(async (request, _ctx, session) => {
  const query = parseSearchParams(request, BudgetResetRequestListQuerySchema);
  const meta = (await getAllAccounts()).find((a) => a.teamId === query.teamId);
  if (!meta) return notFound();

  const scope = await scopeFor(session, [], {
    teamIds: [query.teamId],
    departmentIds: [meta.departmentId],
  });
  if (
    !(
      scope.global ||
      scope.teamScopes.has(query.teamId) ||
      scope.departmentScopes.has(meta.departmentId)
    )
  ) {
    return notFound();
  }

  const page = await listTeamBudgetResetRequests(query.teamId, {
    status: query.status,
    cursorSecret: cursorSecret(),
    ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
  });
  if (!page.ok) return accessErrorResponse(page.code);

  // Q-W2 (MG-D12, BR10): the requester's identity and reason go to the deciders
  // of the team, or to anyone the per-user gate lets see user rows; the rest
  // (the auditor in prod before the approval) get the count only.
  const team = { teamId: query.teamId, departmentId: meta.departmentId };
  const actor = await loadManager(session);
  const personal =
    (actor !== null && mayDecideTeam(actor, team)) ||
    can(scope, "read", { kind: "user-rows", ...team });
  if (!personal) {
    return jsonData({ items: [], count: page.value.items.length });
  }
  return jsonData({
    items: await toRequestViews(page.value.items),
    ...(page.value.cursor !== undefined ? { cursor: page.value.cursor } : {}),
  });
});
