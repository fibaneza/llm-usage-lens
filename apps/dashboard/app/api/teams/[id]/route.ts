import {
  DateRangeQuerySchema,
  TeamDetailResponseSchema,
} from "@llm-usage-lens/shared";

import { aggregateTeamDetail } from "@/lib/aggregate/teams";
import { aggregateUserRows } from "@/lib/aggregate/users";
import { getAllAccountsCached } from "@/lib/api/cached-reads";
import { IdParamSchema } from "@/lib/api/id-param";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import {
  NOT_FOUND_MESSAGE,
  NotFoundError,
  jsonData,
  parseInput,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { redactUsers, scopeFor, teamRollups } from "@/lib/api/scoped-rollups";
import { can } from "@/lib/auth/policy";

export const revalidate = 3600;

export const GET = withRoute(async (request, { params }, session) => {
  const id = parseInput((await params).id, IdParamSchema);
  const { dateFrom, dateTo, accountId } = parseSearchParams(
    request,
    DateRangeQuerySchema,
  );
  const meta = (await getAllAccountsCached()).find((a) => a.teamId === id);
  const rollups = await loadRangeRollups(dateFrom, dateTo, accountId);
  // A team that left AccountMeta but has rollups in range is historical.
  const historical = [...rollups].reverse().find((r) => r.teamId === id);
  const teamName = meta?.teamName ?? historical?.teamName;
  const scope = await scopeFor(session, rollups, { teamIds: [id] });
  const visible = teamRollups(scope, rollups);
  const readable =
    visible.some((r) => r.teamId === id) ||
    can(scope, "read", {
      kind: "team",
      teamId: id,
      departmentId: meta?.departmentId ?? historical?.departmentId ?? "",
      date: dateTo,
    });
  if (teamName === undefined || !readable) {
    throw new NotFoundError(NOT_FOUND_MESSAGE);
  }
  const detail = aggregateTeamDetail(visible, id, { teamName });
  return jsonData(
    TeamDetailResponseSchema.parse({
      ...detail,
      users: aggregateUserRows(
        redactUsers(
          scope,
          visible.filter((r) => r.teamId === id),
        ),
      ),
      departmentId: detail.departmentId || meta?.departmentId,
      departmentName: detail.departmentName || meta?.departmentName,
    }),
  );
});
