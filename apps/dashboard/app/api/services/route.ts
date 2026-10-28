import {
  DateRangeQuerySchema,
  ServicesResponseSchema,
} from "@bedrock-usage/shared";

import { aggregateServices } from "@/lib/aggregate/services";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";

export const revalidate = 3600;

export const GET = withRoute(async (request) => {
  const { dateFrom, dateTo, accountId } = parseSearchParams(
    request,
    DateRangeQuerySchema,
  );
  const rollups = await loadRangeRollups(dateFrom, dateTo, accountId);
  return jsonData(
    ServicesResponseSchema.parse({ services: aggregateServices(rollups) }),
  );
});
