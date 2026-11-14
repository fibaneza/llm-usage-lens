import {
  DateRangeQuerySchema,
  ServicesResponseSchema,
} from "@llm-usage-lens/shared";

import { aggregateServices } from "@/lib/aggregate/services";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { scopeFor, teamRollups } from "@/lib/api/scoped-rollups";

export const revalidate = 3600;

export const GET = withRoute(async (request, _ctx, session) => {
  const { dateFrom, dateTo, accountId } = parseSearchParams(
    request,
    DateRangeQuerySchema,
  );
  const rollups = await loadRangeRollups(dateFrom, dateTo, accountId);
  const scope = await scopeFor(session, rollups);
  return jsonData(
    ServicesResponseSchema.parse({
      services: aggregateServices(teamRollups(scope, rollups)),
    }),
  );
});
