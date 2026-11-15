import {
  DateRangeQuerySchema,
  LiteLLMOrgResponseSchema,
} from "@llm-usage-lens/shared";

import {
  jsonData,
  jsonError,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { getTeam, getTeamDailySpend } from "@/lib/litellm/operations";
import {
  enabledOperations,
  liteLLMResponse,
  reduceDaily,
  requireEnabled,
  teamAccess,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "Views by role (L3b)"
// (Organisation: totals across every linked team via one getTeamDailySpend
// with all linked team_ids, per-team spend, budget and members), "API routes"
// (/api/litellm/org GET: org-admin, Admin, Auditor), "Reads" (timezone=0,
// LD20), LD19, Rule 10.3 (403 before input parsing).

export const dynamic = "force-dynamic";

export const GET = withRoute(async (request, _ctx, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const access = await teamAccess(session);
  if (!access.orgWide) {
    return jsonError(403, "FORBIDDEN", "Insufficient permission");
  }
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  return liteLLMResponse(async () => {
    const enabled = await enabledOperations();
    requireEnabled(enabled, ["getTeam", "getTeamDailySpend"]);
    const { linked } = access;
    if (linked.length === 0) {
      return jsonData(
        LiteLLMOrgResponseSchema.parse({
          totals: { spend: 0 },
          daily: [],
          teams: [],
          enabledOperations: enabled,
        }),
      );
    }
    const [daily, infos] = await Promise.all([
      getTeamDailySpend({
        litellmTeamIds: linked.map((t) => t.litellmTeamId),
        startDate: dateFrom,
        endDate: dateTo,
      }),
      Promise.all(
        linked.map((t) => getTeam({ litellmTeamId: t.litellmTeamId })),
      ),
    ]);
    const rows = reduceDaily(daily.results);
    return jsonData(
      LiteLLMOrgResponseSchema.parse({
        totals: { spend: rows.reduce((sum, r) => sum + r.spend, 0) },
        daily: rows,
        teams: linked.map((t, i) => {
          const info = infos[i];
          return {
            teamId: t.teamId,
            teamName: t.teamName,
            spend: info?.team_info.spend ?? 0,
            maxBudget: info?.team_info.max_budget ?? null,
            memberCount: info?.team_memberships.length ?? 0,
          };
        }),
        enabledOperations: enabled,
      }),
    );
  });
});
