import { DateRangeQuerySchema } from "@llm-usage-lens/shared";

import { IdParamSchema } from "@/lib/api/id-param";
import {
  jsonData,
  parseInput,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { getTeam, getTeamDailySpend } from "@/lib/litellm/operations";
import {
  enabledOperations,
  liteLLMResponse,
  reduceDaily,
  requireEnabled,
  resolveLiteLLMTeam,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId] GET: Lead in scope, Admin, Auditor), "Reads" (getTeam,
// getTeamDailySpend with timezone=0, LD20), "Identity mapping" (an unlinked
// team is "not connected", no LiteLLM call), Access Control — Enforcement
// item 2 (404 parity).

export const dynamic = "force-dynamic";

export const GET = withRoute(async (request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const teamId = parseInput((await params).teamId, IdParamSchema);
  const team = await resolveLiteLLMTeam(session, teamId);
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  const { litellmTeamId } = team;
  if (litellmTeamId === null) return jsonData({ connected: false });
  return liteLLMResponse(async () => {
    const enabled = await enabledOperations();
    requireEnabled(enabled, ["getTeam", "getTeamDailySpend"]);
    const [info, daily] = await Promise.all([
      getTeam({ litellmTeamId }),
      getTeamDailySpend({
        litellmTeamId,
        startDate: dateFrom,
        endDate: dateTo,
      }),
    ]);
    const t = info.team_info;
    return jsonData({
      connected: true,
      team: {
        alias: t.team_alias ?? null,
        spend: t.spend ?? 0,
        maxBudget: t.max_budget ?? null,
        softBudget: t.soft_budget ?? null,
        budgetDuration: t.budget_duration ?? null,
        models: t.models ?? [],
        rpmLimit: t.rpm_limit ?? null,
        tpmLimit: t.tpm_limit ?? null,
      },
      daily: reduceDaily(daily.results),
      enabledOperations: enabled,
    });
  });
});
