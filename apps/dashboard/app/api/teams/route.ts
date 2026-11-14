import { TeamsQuerySchema, TeamsResponseSchema } from "@llm-usage-lens/shared";

import { aggregateTeams } from "@/lib/aggregate/teams";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { scopeFor, teamRollups } from "@/lib/api/scoped-rollups";

export const revalidate = 3600;

export const GET = withRoute(async (request, _ctx, session) => {
  const { dateFrom, dateTo, departmentId } = parseSearchParams(
    request,
    TeamsQuerySchema,
  );
  const rollups = await loadRangeRollups(dateFrom, dateTo);
  const scope = await scopeFor(session, rollups);
  return jsonData(
    TeamsResponseSchema.parse({
      teams: aggregateTeams(teamRollups(scope, rollups), { departmentId }),
    }),
  );
});
