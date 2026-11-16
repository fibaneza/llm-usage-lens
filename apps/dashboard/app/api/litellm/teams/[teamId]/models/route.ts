import { z } from "zod";

import { badRequest, snapshot } from "@/lib/litellm/member-write";
import {
  Models,
  listProxyModels,
  setTeamModels,
} from "@/lib/litellm/operations";
import { allowedModels, teamWriteRoute } from "@/lib/litellm/team-write";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (setTeamModels: POST
// /team/update with team_id and models, a subset of the team's current models; Lead + Admin;
// audit before/after models), "Budgets and limits" (Model access: an unknown
// model is 400; no model write exists), "Gateway guardrails" item 4 (names
// that widen access are refused), LT4, LT14.

export const dynamic = "force-dynamic";

const BodySchema = z.strictObject({ models: Models });

export const PUT = teamWriteRoute(
  {
    action: "litellm.team.models",
    pattern: "/api/litellm/teams/[teamId]/models",
    toggle: "setTeamModels",
    status: 200,
    body: BodySchema,
  },
  async ({ actor, teamId, litellmTeamId, body, teamInfo }) => {
    const info = await teamInfo();
    const listed = new Set((await listProxyModels()).data.map((m) => m.id));
    if (body.models.some((m) => !listed.has(m))) {
      throw badRequest("A model is not listed by the proxy");
    }
    const allowed = await allowedModels(info);
    if (body.models.some((m) => !allowed.has(m))) {
      throw badRequest("A model is not available to the team");
    }
    await setTeamModels({ litellmTeamId, models: body.models }, { actor });
    return {
      data: { teamId, litellmTeamId, models: body.models },
      target: { type: "litellm-team", id: litellmTeamId },
      before: snapshot({ models: info.team_info.models }),
      after: snapshot({ models: body.models }),
    };
  },
);
