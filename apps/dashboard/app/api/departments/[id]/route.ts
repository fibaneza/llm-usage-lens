import {
  DateRangeQuerySchema,
  DepartmentDetailResponseSchema,
} from "@llm-usage-lens/shared";

import { aggregateDepartmentDetail } from "@/lib/aggregate/departments";
import { aggregateUserRows } from "@/lib/aggregate/users";
import { getAccountsByDepartmentCached } from "@/lib/api/cached-reads";
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
import {
  departmentRollups,
  redactUsers,
  scopeFor,
} from "@/lib/api/scoped-rollups";
import { can } from "@/lib/auth/policy";

export const revalidate = 3600;

const TOP_USERS_LIMIT = 10;

export const GET = withRoute(async (request, { params }, session) => {
  const id = parseInput((await params).id, IdParamSchema);
  const { dateFrom, dateTo, accountId } = parseSearchParams(
    request,
    DateRangeQuerySchema,
  );
  const [meta] = await getAccountsByDepartmentCached(id);
  const rollups = await loadRangeRollups(dateFrom, dateTo, accountId);
  // A department that left AccountMeta but has rollups in range is historical.
  const historical = [...rollups].reverse().find((r) => r.departmentId === id);
  const name = meta?.departmentName ?? historical?.departmentName;
  const scope = await scopeFor(session, rollups, { departmentIds: [id] });
  const visible = departmentRollups(scope, rollups);
  const readable =
    visible.some((r) => r.departmentId === id) ||
    can(scope, "read", {
      kind: "department",
      departmentId: id,
      viaMemberTeam: false,
    });
  if (name === undefined || !readable) {
    throw new NotFoundError(NOT_FOUND_MESSAGE);
  }
  const detail = aggregateDepartmentDetail(visible, id, name);
  return jsonData(
    DepartmentDetailResponseSchema.parse({
      ...detail,
      topUsers: aggregateUserRows(
        redactUsers(
          scope,
          visible.filter((r) => r.departmentId === id),
        ),
      ).slice(0, TOP_USERS_LIMIT),
    }),
  );
});
