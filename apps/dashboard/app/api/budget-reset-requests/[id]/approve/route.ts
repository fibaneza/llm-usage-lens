import { randomUUID } from "node:crypto";

import { auditContext } from "@/lib/api/access-route";
import { matrixWrite } from "@/lib/api/matrix-route";
import { jsonData, jsonError } from "@/lib/api/respond";
import { getAffiliation } from "@/lib/data/access/affiliations";
import {
  abortApproval,
  beginApproval,
  completeApproval,
  requestBudgetResetEnabled,
  toRequestViews,
} from "@/lib/data/budget-reset-requests";
import { getTeamLink } from "@/lib/data/litellm/team-links";
import { createNotifications } from "@/lib/data/notifications";
import type { LiteLLMActor } from "@/lib/litellm/gateway";
import {
  audit,
  emailsOf,
  resolveLiteLLMUserId,
} from "@/lib/litellm/member-write";
import { getTeam, resetMemberSpend } from "@/lib/litellm/operations";
import {
  enabledOperations,
  reduceMembers,
  requireEnabled,
} from "@/lib/litellm/read-views";
import { liteLLMErrorResponse } from "@/lib/litellm/route-guard";

import { loadDecidable } from "../../decision";

// Source: docs/specs/2026-11-10-litellm.md — "Budget reset requests", MG-D11
// (resetMemberSpend, not reset_budget), MG-D12/MG-D12a (open -> approving ->
// approved, back to open when LiteLLM fails), BR9 (no notification on a
// failed approval). Access Control BR1, BR2, BR4.

export const dynamic = "force-dynamic";

const PATTERN = "/api/budget-reset-requests/[id]/approve";

export const POST = matrixWrite(
  {
    operation: "member",
    action: "budgetreset.request.approve",
    pattern: PATTERN,
  },
  async (args) => {
    const { session } = args;
    const decidable = await loadDecidable(args, {
      action: "budgetreset.request.approve",
      pattern: PATTERN,
    });
    if (decidable instanceof Response) return decidable;
    const { request } = decidable;
    const { teamId, requesterOid } = request;

    const link = await getTeamLink(teamId);
    if (!link) {
      return jsonError(409, "CONFLICT", "The team is not connected to LiteLLM");
    }
    try {
      if (!(await requestBudgetResetEnabled())) {
        return jsonError(
          403,
          "OPERATION_DISABLED",
          "Budget reset requests are switched off",
        );
      }
      requireEnabled(await enabledOperations(), ["resetMemberSpend"]);
    } catch (error) {
      const response = liteLLMErrorResponse(error);
      if (response) return response;
      throw error;
    }
    if ((await getAffiliation(requesterOid))?.teamId !== teamId) {
      return jsonError(
        409,
        "CONFLICT",
        "The requester is no longer a member of the team",
      );
    }

    const begun = await beginApproval(request, session.user.oid, new Date());
    if (!begun.ok) {
      return jsonError(409, "CONFLICT", "The request has already been decided");
    }

    const actor: LiteLLMActor = {
      oid: session.user.oid,
      email: session.user.email ?? null,
    };
    let litellmUserId: string | null = null;
    let spend = 0;
    let budget: number | null = null;
    try {
      litellmUserId = await resolveLiteLLMUserId(requesterOid);
      if (!litellmUserId) {
        await abortApproval(begun.value);
        return jsonError(409, "CONFLICT", "The requester is not in LiteLLM");
      }
      const teamInfo = await getTeam({ litellmTeamId: link.litellmTeamId });
      const member = reduceMembers(
        teamInfo.team_memberships,
        emailsOf(teamInfo),
      ).find((m) => m.userId === litellmUserId);
      if (!member) {
        await abortApproval(begun.value);
        return jsonError(
          409,
          "CONFLICT",
          "The requester is not a member of the LiteLLM team",
        );
      }
      spend = member.spend;
      budget = member.maxBudget;
      await resetMemberSpend(
        { litellmTeamId: link.litellmTeamId, litellmUserId },
        { actor },
      );
    } catch (error) {
      await abortApproval(begun.value);
      const response = liteLLMErrorResponse(error);
      if (response) {
        await audit(
          session,
          { action: "litellm.member.reset-spend" },
          {
            result: "failed",
            teamId,
            target: { type: "litellm-user", id: litellmUserId ?? requesterOid },
          },
        );
        return response;
      }
      throw error;
    }

    const ctx = auditContext(session);
    const resetId = randomUUID();
    const approved = await completeApproval(
      {
        request: begun.value,
        reset: {
          resetId,
          oid: requesterOid,
          teamId,
          departmentId: request.departmentId,
          litellmTeamId: link.litellmTeamId,
          litellmUserId,
          operation: "spend",
          amount: spend,
          budget,
          trigger: "request",
          actorOid: session.user.oid,
          requestId: request.requestId,
          timestamp: ctx.now.toISOString(),
        },
      },
      ctx,
    );
    await createNotifications(
      [
        {
          recipientOid: requesterOid,
          kind: "budget-reset.approved",
          requestId: request.requestId,
          teamId,
        },
      ],
      ctx.now,
    );
    const [view] = await toRequestViews([approved]);
    return jsonData({ request: view, resetId, amount: spend });
  },
);
