import {
  DateRangeQuerySchema,
  LiteLLMUserDetailResponseSchema,
} from "@llm-usage-lens/shared";

import {
  NOT_FOUND_MESSAGE,
  NotFoundError,
  jsonData,
  parseInput,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { LiteLLMError } from "@/lib/litellm/client";
import { getUser, getUserDailySpend } from "@/lib/litellm/operations";
import {
  LiteLLMUserIdSchema,
  enabledOperations,
  liteLLMResponse,
  reduceDaily,
  requireEnabled,
  teamAccess,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "API routes"
// (/api/litellm/users/[litellmUserId] GET: Lead for a member of a team in
// scope, org-admin, Admin, Auditor; otherwise 404), "Views by role (L3b)"
// (Users tab; out of scope is the same 404 as missing), "Reads" (timezone=0,
// LD20), LT21, Access Control - Enforcement item 2. No keys and no LiteLLM
// team ids leave the route.

export const dynamic = "force-dynamic";

const notFound = () => new NotFoundError(NOT_FOUND_MESSAGE);

export const GET = withRoute(async (request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const access = await teamAccess(session);
  if (!access.orgWide && !access.lead) throw notFound();
  const litellmUserId = parseInput(
    (await params).litellmUserId,
    LiteLLMUserIdSchema,
  );
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  return liteLLMResponse(async () => {
    const enabled = await enabledOperations();
    requireEnabled(
      enabled,
      access.perUserCostHidden ? ["getUser"] : ["getUser", "getUserDailySpend"],
    );
    const info = await getUser({ litellmUserId }).catch((error: unknown) => {
      if (error instanceof LiteLLMError && error.status === 404) {
        throw notFound();
      }
      throw error;
    });
    if (!access.orgWide) {
      const inScope = new Set(access.linked.map((t) => t.litellmTeamId));
      const member = info.teams.some(
        (t) => typeof t.team_id === "string" && inScope.has(t.team_id),
      );
      if (!member) throw notFound();
    }
    // Organisation cap: identity only, no cost read at all (LD23, T16).
    if (access.perUserCostHidden) {
      return jsonData(
        LiteLLMUserDetailResponseSchema.parse({
          userId: litellmUserId,
          email: info.user_info?.user_email ?? litellmUserId,
          enabledOperations: enabled,
        }),
      );
    }
    const daily = await getUserDailySpend({
      litellmUserId,
      startDate: dateFrom,
      endDate: dateTo,
    });
    return jsonData(
      LiteLLMUserDetailResponseSchema.parse({
        userId: litellmUserId,
        email: info.user_info?.user_email ?? litellmUserId,
        spend: info.user_info?.spend ?? 0,
        maxBudget: info.user_info?.max_budget ?? null,
        daily: reduceDaily(daily.results),
        enabledOperations: enabled,
      }),
    );
  });
});
