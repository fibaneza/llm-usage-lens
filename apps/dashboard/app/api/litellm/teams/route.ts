import { randomUUID } from "node:crypto";

import { z } from "zod";

import { IdParamSchema } from "@/lib/api/id-param";
import {
  NOT_FOUND_MESSAGE,
  jsonData,
  jsonError,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { getAllAccounts } from "@/lib/data/account-meta";
import { getTeamLink, putTeamLink } from "@/lib/data/litellm/team-links";
import { LiteLLMOperationRefused } from "@/lib/litellm/gateway";
import { audit, badRequest, snapshot } from "@/lib/litellm/member-write";
import {
  Budget,
  Duration,
  KeyAlias,
  Limit,
  Models,
  createTeam,
  listProxyModels,
} from "@/lib/litellm/operations";
import { enabledOperations, requireEnabled } from "@/lib/litellm/read-views";
import {
  liteLLMErrorResponse,
  openModeRefusal,
} from "@/lib/litellm/route-guard";
import { defined } from "@/lib/litellm/team-write";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (createTeam: POST
// /team/new with the alias, budget, limits, models and the provenance
// metadata; Admin only, LD24; audit the new team id), "Identity mapping"
// (the team link is one-to-one: the new team is linked in this request),
// "API routes" (POST /api/litellm/teams: createTeam + link), LT4, LT14.

export const dynamic = "force-dynamic";

const BodySchema = z.strictObject({
  teamId: IdParamSchema,
  teamAlias: KeyAlias,
  maxBudget: Budget.positive().optional(),
  budgetDuration: Duration.optional(),
  rpmLimit: Limit.min(1).optional(),
  tpmLimit: Limit.min(1).optional(),
  models: Models.optional(),
});

export const POST = withRoute(
  async (request, _ctx, session) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    const { teamId, ...fields } = await parseJsonBody(request, BodySchema);
    if (!(await getAllAccounts()).some((a) => a.teamId === teamId)) {
      return jsonError(404, "NOT_FOUND", NOT_FOUND_MESSAGE);
    }
    if (await getTeamLink(teamId)) {
      return jsonError(409, "CONFLICT", "The team is already linked");
    }

    const record = (
      result: "success" | "failed",
      target: { type: string; id: string },
      after?: ReturnType<typeof snapshot>,
    ) =>
      audit(
        session,
        { action: "litellm.team.create" },
        { result, teamId, target, after },
      );

    try {
      requireEnabled(await enabledOperations(), ["createTeam"]);
      if (fields.models) {
        const listed = new Set((await listProxyModels()).data.map((m) => m.id));
        if (fields.models.some((m) => !listed.has(m))) {
          throw badRequest("A model is not listed by the proxy");
        }
      }
      const { litellmTeamId } = await createTeam(
        {
          dashboardTeamId: teamId,
          teamAlias: fields.teamAlias,
          ...defined({ ...fields, teamAlias: undefined }),
        },
        { actor: { oid: session.user.oid, email: session.user.email ?? null } },
      );
      const linked = await putTeamLink(
        { teamId, litellmTeamId, version: null },
        {
          actor: session.user.oid,
          requestId: randomUUID(),
          now: new Date(),
          sequence: { next: 0 },
        },
      );
      await record(
        "success",
        { type: "litellm-team", id: litellmTeamId },
        snapshot({ teamId, ...fields }),
      );
      if (!linked.ok) {
        return jsonError(409, "CONFLICT", "The link was changed or is in use");
      }
      return jsonData({ teamId, litellmTeamId }, { status: 201 });
    } catch (error) {
      const response = liteLLMErrorResponse(error);
      if (!response) throw error;
      if (!(error instanceof LiteLLMOperationRefused)) {
        await record("failed", { type: "team", id: teamId });
      }
      return response;
    }
  },
  {
    requireAdmin: true,
    denied: {
      action: "litellm.team.create",
      pattern: "/api/litellm/teams",
    },
  },
);
