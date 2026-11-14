import {
  DateRangeQuerySchema,
  UsersResponseSchema,
} from "@llm-usage-lens/shared";

import { aggregateUsers } from "@/lib/aggregate/users";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { redactUsers, scopeFor, teamRollups } from "@/lib/api/scoped-rollups";

export const revalidate = 3600;

export const GET = withRoute(async (request, _ctx, session) => {
  const { dateFrom, dateTo, accountId } = parseSearchParams(
    request,
    DateRangeQuerySchema,
  );
  const rollups = await loadRangeRollups(dateFrom, dateTo, accountId);
  const scope = await scopeFor(session, rollups);
  const visible = redactUsers(scope, teamRollups(scope, rollups));
  return jsonData(
    UsersResponseSchema.parse({ users: aggregateUsers(visible) }),
  );
});
