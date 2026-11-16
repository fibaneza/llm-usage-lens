import { z } from "zod";

import { badRequest, snapshot } from "@/lib/litellm/member-write";
import { Duration, setTeamBudget } from "@/lib/litellm/operations";
import {
  NOTHING_TO_CHANGE,
  PositiveBudget,
  aboveCeiling,
  atLeastOneField,
  defined,
  teamWriteRoute,
} from "@/lib/litellm/team-write";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (setTeamBudget: POST
// /team/update with max_budget, budget_duration, soft_budget; Admin and
// org-admin set or raise, a Lead lowers only; audit before/after), "Budgets
// and limits" (a Lead raising a team value is 400 with no LiteLLM write), LT13.
// The current values are read from LiteLLM, never from the request. The
// duration has no comparable current value, so a Lead sending it is 400.

export const dynamic = "force-dynamic";

const BodySchema = z
  .strictObject({
    maxBudget: PositiveBudget.optional(),
    budgetDuration: Duration.optional(),
    softBudget: PositiveBudget.optional(),
  })
  .refine(atLeastOneField, NOTHING_TO_CHANGE);

export const PATCH = teamWriteRoute(
  {
    action: "litellm.team.budget",
    pattern: "/api/litellm/teams/[teamId]/budget",
    toggle: "setTeamBudget",
    status: 200,
    body: BodySchema,
  },
  async ({ actor, lead, teamId, litellmTeamId, body, teamInfo }) => {
    const team = (await teamInfo()).team_info;
    if (
      lead &&
      (body.budgetDuration !== undefined ||
        aboveCeiling(body.maxBudget, team.max_budget) ||
        aboveCeiling(body.softBudget, team.soft_budget))
    ) {
      throw badRequest("A team lead may only lower the team's budget");
    }
    const given = defined(body);
    await setTeamBudget({ litellmTeamId, ...given }, { actor });
    const current = {
      maxBudget: team.max_budget,
      budgetDuration: team.budget_duration,
      softBudget: team.soft_budget,
    };
    const changed = Object.keys(given) as Array<keyof typeof current>;
    return {
      data: { teamId, litellmTeamId, ...given },
      target: { type: "litellm-team", id: litellmTeamId },
      before: snapshot(Object.fromEntries(changed.map((k) => [k, current[k]]))),
      after: snapshot(given),
    };
  },
);
