import {
  CombinedTeamsResponseSchema,
  DateRangeQuerySchema,
} from "@llm-usage-lens/shared";
import type { CombinedTeamFigure } from "@llm-usage-lens/shared";

import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { listTeamLinks } from "@/lib/data/litellm/team-links";
import { isLiteLLMConfigured } from "@/lib/litellm/client";
import { combinedVisibility, computeTeam } from "@/lib/litellm/combined";
import type { LiteLLMSide } from "@/lib/litellm/combined";
import { loadGateway, readTeamSide } from "@/lib/litellm/combined-data";
import {
  enabledOperations,
  liteLLMResponse,
  requireEnabled,
} from "@/lib/litellm/read-views";
import { litellmReadRefusal, openModeRefusal } from "@/lib/litellm/route-guard";
import { runBoundedSettled } from "@/lib/litellm/run-settled";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Routes (a row per team in the range, combined only on linked teams;
// global readers only: LT32), The computation (Team), Visibility, States;
// LD36 (the linked team's spend), LD34 (bounded reads); Rule 10.3.

export const dynamic = "force-dynamic";

const READ_CONCURRENCY = 5;

export const GET = withRoute(async (request, _ctx, session) => {
  const refused = openModeRefusal() ?? (await litellmReadRefusal(session));
  if (refused) return refused;
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  const range = { startDate: dateFrom, endDate: dateTo };
  return liteLLMResponse(async () => {
    const [gateway, configured, enabled, links] = await Promise.all([
      loadGateway(),
      isLiteLLMConfigured(),
      enabledOperations(),
      listTeamLinks(),
    ]);
    requireEnabled(enabled, ["getTeamDailySpend"]);
    const rollups = await loadRangeRollups(dateFrom, dateTo);
    const names = new Map<string, string>();
    for (const r of rollups) names.set(r.teamId, r.teamName);
    const linkOf = new Map(links.map((l) => [l.teamId, l.litellmTeamId]));

    const sides = new Map<string, LiteLLMSide>();
    await runBoundedSettled(
      [...names.keys()],
      READ_CONCURRENCY,
      async (teamId) => {
        const litellmTeamId = linkOf.get(teamId);
        if (!configured) {
          sides.set(teamId, { kind: "not-configured" });
        } else if (litellmTeamId === undefined) {
          sides.set(teamId, { kind: "not-linked" });
        } else {
          sides.set(teamId, await readTeamSide(litellmTeamId, range));
        }
      },
    );

    const teams: CombinedTeamFigure[] = [...names]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([teamId, teamName]) => ({
        teamId,
        teamName,
        ...computeTeam({
          teamId,
          rollups,
          gateway,
          litellm: sides.get(teamId) ?? { kind: "not-linked" },
        }),
      }));
    return jsonData(
      CombinedTeamsResponseSchema.parse({
        visibility: combinedVisibility(true, gateway.configured),
        configured,
        gatewayConfigured: gateway.configured,
        teams,
      }),
    );
  });
});
