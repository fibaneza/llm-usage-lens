import { z } from "zod";

import {
  badRequest,
  memberWriteRoute,
  snapshot,
} from "@/lib/litellm/member-write";
import { Duration, setMemberBudget } from "@/lib/litellm/operations";
import { PositiveBudget } from "@/lib/litellm/team-write";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (setMemberBudget: Lead +
// Admin; POST /team/member_update with the budget fields only), "Budgets and
// limits" (member max_budget_in_team <= the team's max_budget, else 400 with
// no LiteLLM write), LT13.

export const dynamic = "force-dynamic";

const BodySchema = z
  .strictObject({
    maxBudgetInTeam: PositiveBudget.optional(),
    budgetDuration: Duration.optional(),
  })
  .refine(
    (v) => v.maxBudgetInTeam !== undefined || v.budgetDuration !== undefined,
    { message: "Nothing to change" },
  );

export const PATCH = memberWriteRoute(
  {
    action: "litellm.member.budget",
    pattern: "/api/litellm/teams/[teamId]/members/[oid]/budget",
    toggle: "setMemberBudget",
    status: 200,
    target: "existing",
    oidFrom: "path",
    body: BodySchema,
  },
  async ({
    actor,
    litellmTeamId,
    oid,
    litellmUserId,
    body,
    teamInfo,
    member,
  }) => {
    const ceiling = teamInfo.team_info.max_budget;
    if (
      body.maxBudgetInTeam !== undefined &&
      ceiling !== null &&
      ceiling !== undefined &&
      body.maxBudgetInTeam > ceiling
    ) {
      throw badRequest("The member budget is above the team's budget");
    }
    await setMemberBudget(
      {
        litellmTeamId,
        litellmUserId,
        ...(body.maxBudgetInTeam === undefined
          ? {}
          : { maxBudgetInTeam: body.maxBudgetInTeam }),
        ...(body.budgetDuration === undefined
          ? {}
          : { budgetDuration: body.budgetDuration }),
      },
      { actor },
    );
    return {
      data: {
        oid,
        litellmUserId,
        ...(body.maxBudgetInTeam === undefined
          ? {}
          : { maxBudgetInTeam: body.maxBudgetInTeam }),
        ...(body.budgetDuration === undefined
          ? {}
          : { budgetDuration: body.budgetDuration }),
      },
      before: snapshot({
        litellmUserId,
        maxBudgetInTeam:
          body.maxBudgetInTeam === undefined ? undefined : member?.maxBudget,
      }),
      after: snapshot({
        litellmUserId,
        maxBudgetInTeam: body.maxBudgetInTeam,
      }),
    };
  },
);
