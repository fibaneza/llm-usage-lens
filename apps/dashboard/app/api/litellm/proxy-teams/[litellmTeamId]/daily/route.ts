import {
  DateRangeQuerySchema,
  LiteLLMProxyTeamDailyResponseSchema,
} from "@llm-usage-lens/shared";

import {
  jsonData,
  jsonError,
  parseInput,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { isLiteLLMConfigured } from "@/lib/litellm/client";
import { PathLiteLLMId } from "@/lib/litellm/litellm-id-write";
import { getTeamDailySpend } from "@/lib/litellm/operations";
import {
  enabledOperations,
  liteLLMResponse,
  reduceDaily,
  requireEnabled,
  teamAccess,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "API routes" (GET
// /api/litellm/proxy-teams/[litellmTeamId]/daily, unit LP3, T-LP12: Admin,
// org-admin, Auditor; a Lead 403 before parsing; the team's daily spend,
// requests and tokens; no key, key alias, member or per-user figure), LD19
// (off -> 403 before any call), LD23 (the cap omits daily, no call), LD37
// (not configured -> 200, empty, no call), LT1. Refusal order as the sibling
// team route.

export const dynamic = "force-dynamic";

export const GET = withRoute(async (request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const access = await teamAccess(session);
  if (!access.orgWide) {
    return jsonError(403, "FORBIDDEN", "Insufficient permission");
  }
  const litellmTeamId = parseInput((await params).litellmTeamId, PathLiteLLMId);
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  return liteLLMResponse(async () => {
    const enabled = await enabledOperations();
    requireEnabled(enabled, ["getTeamDailySpend"]);
    if (!(await isLiteLLMConfigured())) {
      return jsonData(
        LiteLLMProxyTeamDailyResponseSchema.parse({
          litellmTeamId,
          daily: [],
          enabledOperations: enabled,
        }),
      );
    }
    // Organisation cap: no per-user cost, so no daily read at all (LD23).
    if (access.perUserCostHidden) {
      return jsonData(
        LiteLLMProxyTeamDailyResponseSchema.parse({
          litellmTeamId,
          enabledOperations: enabled,
        }),
      );
    }
    const daily = await getTeamDailySpend({
      litellmTeamId,
      startDate: dateFrom,
      endDate: dateTo,
    });
    return jsonData(
      LiteLLMProxyTeamDailyResponseSchema.parse({
        litellmTeamId,
        daily: reduceDaily(daily.results).map((d) => ({
          date: d.date,
          spend: d.spend,
          requests: d.apiRequests,
          tokens: d.totalTokens,
        })),
        enabledOperations: enabled,
      }),
    );
  });
});
