import { LiteLLMMembersResponseSchema } from "@llm-usage-lens/shared";

import { IdParamSchema } from "@/lib/api/id-param";
import { jsonData, parseInput, withRoute } from "@/lib/api/respond";
import { mapTeamMembers } from "@/lib/data/litellm/team-members";
import { getTeam } from "@/lib/litellm/operations";
import {
  liteLLMResponse,
  reduceMembers,
  resolveLiteLLMTeam,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId]/members GET in scope), "Roles and rights" (a Lead sees members'
// spend, budgets and limits), "Reads" (getTeam; team_memberships are loose
// rows reduced to allowlisted fields), "Identity mapping and members".

export const dynamic = "force-dynamic";

export const GET = withRoute(async (_request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const teamId = parseInput((await params).teamId, IdParamSchema);
  const team = await resolveLiteLLMTeam(session, teamId);
  const { litellmTeamId } = team;
  if (litellmTeamId === null) return jsonData({ connected: false, items: [] });
  return liteLLMResponse(async () => {
    const info = await getTeam({ litellmTeamId });
    const emails = new Map(
      (info.team_info.members_with_roles ?? []).flatMap((m) =>
        m.user_id && m.user_email ? [[m.user_id, m.user_email] as const] : [],
      ),
    );
    const dashboardMembers = await mapTeamMembers(teamId);
    const items = reduceMembers(info.team_memberships, emails).map((m) => {
      const { spend, maxBudget, budgetDuration, ...identity } = m;
      const person =
        dashboardMembers.get(m.userId.toLowerCase()) ??
        dashboardMembers.get(m.email.toLowerCase());
      return {
        ...identity,
        ...(team.perUserCostHidden ? {} : { spend, maxBudget, budgetDuration }),
        ...(person ? { oid: person.oid, name: person.name } : {}),
      };
    });
    return jsonData(
      LiteLLMMembersResponseSchema.parse({ connected: true, items }),
    );
  });
});
