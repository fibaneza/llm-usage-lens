import { trace } from "@opentelemetry/api";

import { LiteLLMProxyTeamResponseSchema } from "@llm-usage-lens/shared";

import { cursorSecret } from "@/lib/api/access-route";
import {
  NOT_FOUND_MESSAGE,
  NotFoundError,
  jsonData,
  jsonError,
  parseInput,
  withRoute,
} from "@/lib/api/respond";
import { buildTeamDirectory } from "@/lib/api/team-directory";
import { getAllAccounts } from "@/lib/data/account-meta";
import { listAppTeams } from "@/lib/data/access/app-teams";
import { leadNamesOfTeam } from "@/lib/data/access/team-lead";
import { listTeamLinks } from "@/lib/data/litellm/team-links";
import { LiteLLMError, isLiteLLMConfigured } from "@/lib/litellm/client";
import { PathLiteLLMId } from "@/lib/litellm/litellm-id-write";
import { getTeam } from "@/lib/litellm/operations";
import {
  enabledOperations,
  liteLLMResponse,
  requireEnabled,
  teamAccess,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "API routes" (GET
// /api/litellm/proxy-teams/[litellmTeamId], unit LP1: Admin, org-admin,
// Auditor; a Lead 403; unknown 404; alias, spend, budget and its reset time,
// member count, models, linked app team with lead names; no key, key alias or
// secret), LD19 (off -> 403 before any call), LD23 (the cap omits spend and
// budget), LD37 (not configured -> 200, no call), LT1, LT5. Refusal order as
// the sibling members route.

export const dynamic = "force-dynamic";

// LiteLLM's openapi types budget_reset_at as date-time or null. An absent or
// unparseable value is null; the raw value is never recorded or shown. A
// valid value is already an ISO date-time and is answered as received.
function resetAt(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const time = new Date(raw).getTime();
  if (Number.isNaN(time)) {
    trace.getActiveSpan()?.addEvent("litellm.team.budget_reset_at.unparseable");
    return null;
  }
  return raw;
}

async function linkedAppTeam(litellmTeamId: string) {
  const link = (await listTeamLinks()).find(
    (l) => l.litellmTeamId === litellmTeamId,
  );
  if (!link) return null;
  const [accounts, teams] = await Promise.all([
    getAllAccounts(),
    listAppTeams(),
  ]);
  const team = buildTeamDirectory(accounts, teams).find(
    (t) => t.teamId === link.teamId,
  );
  if (!team) return null;
  const names = await leadNamesOfTeam(link.teamId, cursorSecret());
  return {
    teamId: team.teamId,
    name: team.teamName,
    leads: names.map((name) => ({ name })),
  };
}

export const GET = withRoute(async (_request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const access = await teamAccess(session);
  if (!access.orgWide) {
    return jsonError(403, "FORBIDDEN", "Insufficient permission");
  }
  const litellmTeamId = parseInput((await params).litellmTeamId, PathLiteLLMId);
  return liteLLMResponse(async () => {
    const enabled = await enabledOperations();
    requireEnabled(enabled, ["getTeam"]);
    if (!(await isLiteLLMConfigured())) {
      return jsonData(
        LiteLLMProxyTeamResponseSchema.parse({
          litellmTeamId,
          alias: null,
          budgetResetAt: null,
          memberCount: 0,
          models: [],
          enabledOperations: enabled,
          linkedAppTeam: await linkedAppTeam(litellmTeamId),
        }),
      );
    }
    const info = await getTeam({ litellmTeamId }).catch((error: unknown) => {
      if (error instanceof LiteLLMError && error.status === 404) {
        throw new NotFoundError(NOT_FOUND_MESSAGE);
      }
      throw error;
    });
    const team = info.team_info;
    return jsonData(
      LiteLLMProxyTeamResponseSchema.parse({
        litellmTeamId,
        alias: team.team_alias ?? null,
        ...(access.perUserCostHidden
          ? {}
          : {
              ...(team.spend == null ? {} : { spend: team.spend }),
              maxBudget: team.max_budget ?? null,
            }),
        budgetResetAt: resetAt(team.budget_reset_at),
        memberCount: team.members_with_roles?.length ?? 0,
        models: team.models ?? [],
        enabledOperations: enabled,
        linkedAppTeam: await linkedAppTeam(litellmTeamId),
      }),
    );
  });
});
