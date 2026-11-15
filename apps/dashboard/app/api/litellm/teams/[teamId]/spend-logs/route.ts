import {
  DateRangeQuerySchema,
  LiteLLMSpendLogsResponseSchema,
} from "@llm-usage-lens/shared";

import { IdParamSchema } from "@/lib/api/id-param";
import {
  jsonData,
  parseInput,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { listSpendLogs } from "@/lib/litellm/operations";
import {
  PageQuerySchema,
  liteLLMResponse,
  reduceSpendLogs,
  resolveLiteLLMTeam,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId]/spend-logs GET in scope), "Reads" (listSpendLogs: team_id, dates
// <= 90 days, page, page_size <= 100), "Cost visualisation and provenance"
// (request rows are loose: prompt and response text, api_key, metadata and
// tags never leave the server), threat LT1.

export const dynamic = "force-dynamic";

export const GET = withRoute(async (request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const teamId = parseInput((await params).teamId, IdParamSchema);
  const team = await resolveLiteLLMTeam(session, teamId);
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  const { page, pageSize } = parseSearchParams(request, PageQuerySchema);
  const { litellmTeamId } = team;
  if (litellmTeamId === null) return jsonData({ connected: false, items: [] });
  return liteLLMResponse(async () => {
    const res = await listSpendLogs({
      litellmTeamId,
      startDate: dateFrom,
      endDate: dateTo,
      page,
      pageSize,
    });
    const items = reduceSpendLogs(res.data);
    return jsonData(
      LiteLLMSpendLogsResponseSchema.parse({
        connected: true,
        items,
        page: res.page ?? page ?? 1,
        totalPages: res.total_pages ?? 1,
        total: res.total ?? items.length,
      }),
    );
  });
});
