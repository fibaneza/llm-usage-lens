import {
  DateRangeQuerySchema,
  TeamDetailResponseSchema,
} from "@llm-usage-lens/shared";

import { aggregateTeamDetail } from "@/lib/aggregate/teams";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import {
  NotFoundError,
  jsonData,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { getAllAccountsCached } from "@/lib/api/cached-reads";

export const revalidate = 3600;

export const GET = withRoute(async (request, { params }) => {
  const { id } = await params;
  if (!id) throw new NotFoundError("Missing id");
  const { dateFrom, dateTo, accountId } = parseSearchParams(
    request,
    DateRangeQuerySchema,
  );
  const meta = (await getAllAccountsCached()).find((a) => a.teamId === id);
  const rollups = await loadRangeRollups(dateFrom, dateTo, accountId);
  // A team that left AccountMeta but has rollups in range is historical.
  const historical = [...rollups].reverse().find((r) => r.teamId === id);
  const teamName = meta?.teamName ?? historical?.teamName;
  if (teamName === undefined) throw new NotFoundError(`Team ${id} not found`);
  const detail = aggregateTeamDetail(rollups, id, { teamName });
  return jsonData(
    TeamDetailResponseSchema.parse({
      ...detail,
      departmentId: detail.departmentId || meta?.departmentId,
      departmentName: detail.departmentName || meta?.departmentName,
    }),
  );
});
