import { z } from "zod";

import { badRequest, snapshot } from "@/lib/litellm/member-write";
import { MODEL_RE, setTeamLimits } from "@/lib/litellm/operations";
import {
  NOTHING_TO_CHANGE,
  PositiveLimit,
  aboveCeiling,
  allowedModels,
  atLeastOneField,
  defined,
  teamWriteRoute,
} from "@/lib/litellm/team-write";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (setTeamLimits: POST
// /team/update with the limit fields; Admin and org-admin set or raise, a
// Lead lowers only; audit before/after), "Budgets and limits" (positive
// integers or unset, never 0; per-model limits only for models the team has;
// a Lead raising is 400 with no call), LT10, LT13. The per-model and
// per-member limits have no comparable current value, so a Lead sending them
// is 400 (fail closed).

export const dynamic = "force-dynamic";

const ModelLimitMap = z.record(z.string().regex(MODEL_RE), PositiveLimit);
const BodySchema = z
  .strictObject({
    rpmLimit: PositiveLimit.optional(),
    tpmLimit: PositiveLimit.optional(),
    teamMemberRpmLimit: PositiveLimit.optional(),
    teamMemberTpmLimit: PositiveLimit.optional(),
    modelRpmLimit: ModelLimitMap.optional(),
    modelTpmLimit: ModelLimitMap.optional(),
  })
  .refine(atLeastOneField, NOTHING_TO_CHANGE);

const entries = (map: Record<string, number>) =>
  Object.entries(map).map(([model, limit]) => `${model}=${limit}`);

export const PATCH = teamWriteRoute(
  {
    action: "litellm.team.limits",
    pattern: "/api/litellm/teams/[teamId]/limits",
    toggle: "setTeamLimits",
    status: 200,
    body: BodySchema,
  },
  async ({ actor, lead, teamId, litellmTeamId, body, teamInfo }) => {
    const info = await teamInfo();
    const team = info.team_info;
    if (
      lead &&
      (body.teamMemberRpmLimit !== undefined ||
        body.teamMemberTpmLimit !== undefined ||
        body.modelRpmLimit !== undefined ||
        body.modelTpmLimit !== undefined ||
        aboveCeiling(body.rpmLimit, team.rpm_limit) ||
        aboveCeiling(body.tpmLimit, team.tpm_limit))
    ) {
      throw badRequest("A team lead may only lower the team's limits");
    }
    const perModel = [body.modelRpmLimit, body.modelTpmLimit].flatMap((m) =>
      m ? Object.keys(m) : [],
    );
    if (perModel.length > 0) {
      const allowed = await allowedModels(info);
      if (perModel.some((m) => !allowed.has(m))) {
        throw badRequest("A model is not available to the team");
      }
    }
    const given = defined(body);
    await setTeamLimits({ litellmTeamId, ...given }, { actor });
    const { modelRpmLimit, modelTpmLimit, ...plain } = given;
    const current = { rpmLimit: team.rpm_limit, tpmLimit: team.tpm_limit };
    const changed = Object.keys(plain).filter(
      (k): k is keyof typeof current => k in current,
    );
    return {
      data: { teamId, litellmTeamId, ...given },
      target: { type: "litellm-team", id: litellmTeamId },
      before: snapshot(Object.fromEntries(changed.map((k) => [k, current[k]]))),
      after: snapshot({
        ...plain,
        modelRpmLimit: modelRpmLimit ? entries(modelRpmLimit) : undefined,
        modelTpmLimit: modelTpmLimit ? entries(modelTpmLimit) : undefined,
      }),
    };
  },
);
