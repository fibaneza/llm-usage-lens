import {
  DateRangeQuerySchema,
  TeamDetailResponseSchema,
} from "@bedrock-usage/shared";

import { aggregateTeamDetail } from "@/lib/aggregate/teams";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import {
  NotFoundError,
  jsonData,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { getAllAccounts } from "@/lib/data/account-meta";

export const revalidate = 3600;

export const GET = withRoute(async (request, { params }) => {
  const { id } = await params;
  if (!id) throw new NotFoundError("Missing id");
  const { dateFrom, dateTo, accountId } = parseSearchParams(
    request,
    DateRangeQuerySchema,
  );
  const meta = (await getAllAccounts()).find((a) => a.teamId === id);
  if (!meta) throw new NotFoundError(`Team ${id} not found`);
  const rollups = await loadRangeRollups(dateFrom, dateTo, accountId);
  const detail = aggregateTeamDetail(rollups, id, { teamName: meta.teamName });
  return jsonData(
    TeamDetailResponseSchema.parse({
      ...detail,
      departmentId: detail.departmentId || meta.departmentId,
      departmentName: detail.departmentName || meta.departmentName,
    }),
  );
});
