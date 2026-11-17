import {
  DateRangeQuerySchema,
  LiteLLMTeamDetailResponseSchema,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import { IdParamSchema } from "@/lib/api/id-param";
import {
  jsonData,
  parseInput,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { isLiteLLMConfigured } from "@/lib/litellm/client";
import { getTeam, getTeamDailySpend } from "@/lib/litellm/operations";
import {
  enabledOperations,
  isOrgWideReader,
  liteLLMResponse,
  reduceDaily,
  requireEnabled,
  resolveLiteLLMTeam,
} from "@/lib/litellm/read-views";
import { computeMemberSum } from "@/lib/litellm/member-sum";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId] GET: Lead in scope, Admin, Auditor), "Reads" (getTeam,
// getTeamDailySpend with timezone=0, LD20), "Identity mapping" (an unlinked
// team is "not connected", no LiteLLM call), Access Control — Enforcement
// item 2 (404 parity); docs/specs/2026-11-17-app-teams.md — "Spend source",
// "Member sum", "API changes" (spendSource always returned; include=memberSum
// honoured only for Admin, org-admin and Auditor, ATT6).

const IncludeQuerySchema = z.object({
  include: z.literal("memberSum").optional(),
});

export const dynamic = "force-dynamic";

export const GET = withRoute(async (request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const teamId = parseInput((await params).teamId, IdParamSchema);
  const team = await resolveLiteLLMTeam(session, teamId);
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  const { include } = parseSearchParams(request, IncludeQuerySchema);
  const { litellmTeamId, perUserCostHidden } = team;
  const range = { startDate: dateFrom, endDate: dateTo };
  return liteLLMResponse(async () => {
    // LD37: not configured answers 200 with no LiteLLM call.
    if (!(await isLiteLLMConfigured())) {
      return jsonData(
        LiteLLMTeamDetailResponseSchema.parse({
          configured: false,
          connected: litellmTeamId !== null,
          spendSource: litellmTeamId === null ? "member-sum" : "litellm-team",
          daily: [],
        }),
      );
    }
    if (litellmTeamId === null) {
      const memberSum = await computeMemberSum({
        teamId,
        ...range,
        perUserCostHidden,
      });
      return jsonData(
        LiteLLMTeamDetailResponseSchema.parse({
          connected: false,
          spendSource: "member-sum",
          daily: memberSum.daily,
          memberSum,
        }),
      );
    }
    const wantsMemberSum =
      include === "memberSum" && (await isOrgWideReader(session));
    const enabled = await enabledOperations();
    requireEnabled(enabled, [
      "getTeam",
      "getTeamDailySpend",
      ...(wantsMemberSum ? (["getUserDailySpend"] as const) : []),
    ]);
    // LT25: a failed read stops the member sum, and the response waits for
    // the member reads already in flight.
    const halt = { stopped: false };
    const run: { failure: { error: unknown } | null } = { failure: null };
    const guard = <T>(read: Promise<T>) =>
      read.catch((error: unknown) => {
        halt.stopped = true;
        run.failure ??= { error };
        throw error;
      });
    const settled = await Promise.allSettled([
      guard(getTeam({ litellmTeamId })),
      guard(getTeamDailySpend({ litellmTeamId, ...range })),
      wantsMemberSum
        ? guard(computeMemberSum({ teamId, ...range, perUserCostHidden, halt }))
        : Promise.resolve(undefined),
    ]);
    if (run.failure) throw run.failure.error;
    const [infoRead, dailyRead, sumRead] = settled;
    if (
      infoRead.status !== "fulfilled" ||
      dailyRead.status !== "fulfilled" ||
      sumRead.status !== "fulfilled"
    ) {
      throw new Error("A LiteLLM read failed without being recorded");
    }
    const info = infoRead.value;
    const daily = dailyRead.value;
    const memberSum = sumRead.value;
    const t = info.team_info;
    return jsonData(
      LiteLLMTeamDetailResponseSchema.parse({
        connected: true,
        spendSource: "litellm-team",
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
        ...(memberSum ? { memberSum } : {}),
      }),
    );
  });
});
