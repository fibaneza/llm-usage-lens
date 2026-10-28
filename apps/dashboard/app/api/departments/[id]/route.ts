import {
  DateRangeQuerySchema,
  DepartmentDetailResponseSchema,
} from "@bedrock-usage/shared";

import { aggregateDepartmentDetail } from "@/lib/aggregate/departments";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import {
  NotFoundError,
  jsonData,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { getAccountsByDepartment } from "@/lib/data/account-meta";

export const revalidate = 3600;

export const GET = withRoute(async (request, { params }) => {
  const { id } = await params;
  if (!id) throw new NotFoundError("Missing id");
  const { dateFrom, dateTo, accountId } = parseSearchParams(
    request,
    DateRangeQuerySchema,
  );
  const [meta] = await getAccountsByDepartment(id);
  if (!meta) throw new NotFoundError(`Department ${id} not found`);
  const rollups = await loadRangeRollups(dateFrom, dateTo, accountId);
  return jsonData(
    DepartmentDetailResponseSchema.parse(
      aggregateDepartmentDetail(rollups, id, meta.departmentName),
    ),
  );
});
