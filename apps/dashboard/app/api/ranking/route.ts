import {
  RankingQuerySchema,
  RankingResponseSchema,
} from "@llm-usage-lens/shared";

import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import {
  departmentRollups,
  redactUsers,
  scopeFor,
  teamRollups,
} from "@/lib/api/scoped-rollups";
import { rankEntities } from "@/lib/aggregate/ranking";

export const revalidate = 3600;

export const GET = withRoute(async (request, _ctx, session) => {
  const { dateFrom, dateTo, ...options } = parseSearchParams(
    request,
    RankingQuerySchema,
  );
  const rollups = await loadRangeRollups(dateFrom, dateTo);
  const scope = await scopeFor(session, rollups);
  const visible =
    options.tab === "departments"
      ? departmentRollups(scope, rollups)
      : options.tab === "users"
        ? redactUsers(scope, teamRollups(scope, rollups))
        : teamRollups(scope, rollups);
  return jsonData(
    RankingResponseSchema.parse({
      tab: options.tab,
      rows: rankEntities(visible, options),
    }),
  );
});
