import {
  RankingQuerySchema,
  RankingResponseSchema,
} from "@llm-usage-lens/shared";

import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { rankEntities } from "@/lib/aggregate/ranking";

export const revalidate = 3600;

export const GET = withRoute(async (request) => {
  const { dateFrom, dateTo, ...options } = parseSearchParams(
    request,
    RankingQuerySchema,
  );
  const rollups = await loadRangeRollups(dateFrom, dateTo);
  return jsonData(
    RankingResponseSchema.parse({
      tab: options.tab,
      rows: rankEntities(rollups, options),
    }),
  );
});
