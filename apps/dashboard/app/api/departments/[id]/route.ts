import {
  DateRangeQuerySchema,
  DepartmentDetailResponseSchema,
} from "@llm-usage-lens/shared";

import { aggregateDepartmentDetail } from "@/lib/aggregate/departments";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import {
  NotFoundError,
  jsonData,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { getAccountsByDepartmentCached } from "@/lib/api/cached-reads";

export const revalidate = 3600;

export const GET = withRoute(async (request, { params }) => {
  const { id } = await params;
  if (!id) throw new NotFoundError("Missing id");
  const { dateFrom, dateTo, accountId } = parseSearchParams(
    request,
    DateRangeQuerySchema,
  );
  const [meta] = await getAccountsByDepartmentCached(id);
  const rollups = await loadRangeRollups(dateFrom, dateTo, accountId);
  // A department that left AccountMeta but has rollups in range is historical.
  const historical = [...rollups].reverse().find((r) => r.departmentId === id);
  const name = meta?.departmentName ?? historical?.departmentName;
  if (name === undefined) throw new NotFoundError(`Department ${id} not found`);
  return jsonData(
    DepartmentDetailResponseSchema.parse(
      aggregateDepartmentDetail(rollups, id, name),
    ),
  );
});
