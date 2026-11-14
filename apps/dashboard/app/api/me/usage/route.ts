import { DateRangeQuerySchema } from "@llm-usage-lens/shared";

import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import {
  MeUsageResponseSchema,
  aggregateOwnUsage,
  ownUsageKeys,
} from "@/lib/api/me";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { scopeFor } from "@/lib/api/scoped-rollups";

export const GET = withRoute(async (request, _ctx, session) => {
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  const rollups = await loadRangeRollups(dateFrom, dateTo);
  const scope = await scopeFor(session, []);
  return jsonData(
    MeUsageResponseSchema.parse(
      aggregateOwnUsage(rollups, ownUsageKeys(scope, session.user.email)),
    ),
  );
});
