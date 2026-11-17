import {
  CombinedTeamResponseSchema,
  DateRangeQuerySchema,
} from "@llm-usage-lens/shared";

import { IdParamSchema } from "@/lib/api/id-param";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import {
  NOT_FOUND_MESSAGE,
  NotFoundError,
  jsonData,
  parseInput,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { getAllAccounts } from "@/lib/data/account-meta";
import { getTeamLink } from "@/lib/data/litellm/team-links";
import { isLiteLLMConfigured } from "@/lib/litellm/client";
import { combinedVisibility, computeTeam } from "@/lib/litellm/combined";
import type { LiteLLMSide } from "@/lib/litellm/combined";
import { loadGateway, readTeamSide } from "@/lib/litellm/combined-data";
import {
  enabledOperations,
  isOrgWideReader,
  liteLLMResponse,
  requireEnabled,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Routes (global readers; anyone else gets the missing-team 404, the
// same body: Access Control - Enforcement item 2, LT32), The computation
// (Team), States. A team with no rollup in the range is all zeros.

export const dynamic = "force-dynamic";

export const GET = withRoute(async (request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  if (!(await isOrgWideReader(session))) {
    throw new NotFoundError(NOT_FOUND_MESSAGE);
  }
  const teamId = parseInput((await params).teamId, IdParamSchema);
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  const meta = (await getAllAccounts()).find((a) => a.teamId === teamId);
  if (!meta) throw new NotFoundError(NOT_FOUND_MESSAGE);
  return liteLLMResponse(async () => {
    const [gateway, configured, enabled, link] = await Promise.all([
      loadGateway(),
      isLiteLLMConfigured(),
      enabledOperations(),
      getTeamLink(teamId),
    ]);
    requireEnabled(enabled, ["getTeamDailySpend"]);
    let litellm: LiteLLMSide = { kind: "not-configured" };
    if (configured) {
      if (link) {
        litellm = await readTeamSide(link.litellmTeamId, {
          startDate: dateFrom,
          endDate: dateTo,
        });
      } else {
        litellm = { kind: "not-linked" };
      }
    }
    const rollups = await loadRangeRollups(dateFrom, dateTo);
    return jsonData(
      CombinedTeamResponseSchema.parse({
        visibility: combinedVisibility(true, gateway.configured),
        configured,
        gatewayConfigured: gateway.configured,
        teamId,
        teamName: meta.teamName,
        ...computeTeam({ teamId, rollups, gateway, litellm }),
      }),
    );
  });
});
