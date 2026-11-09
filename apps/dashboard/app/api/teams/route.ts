import { TeamsQuerySchema, TeamsResponseSchema } from "@llm-usage-lens/shared";

import { aggregateTeams } from "@/lib/aggregate/teams";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";

export const revalidate = 3600;

export const GET = withRoute(async (request) => {
  const { dateFrom, dateTo, departmentId } = parseSearchParams(
    request,
    TeamsQuerySchema,
  );
  const rollups = await loadRangeRollups(dateFrom, dateTo);
  return jsonData(
    TeamsResponseSchema.parse({
      teams: aggregateTeams(rollups, { departmentId }),
    }),
  );
});
