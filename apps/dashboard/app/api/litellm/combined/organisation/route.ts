import {
  CombinedOrganisationResponseSchema,
  DateRangeQuerySchema,
} from "@llm-usage-lens/shared";

import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { isLiteLLMConfigured } from "@/lib/litellm/client";
import {
  combinedVisibility,
  computeOrganisation,
} from "@/lib/litellm/combined";
import { loadGateway, readOrganisationSide } from "@/lib/litellm/combined-data";
import {
  enabledOperations,
  liteLLMResponse,
  requireEnabled,
} from "@/lib/litellm/read-views";
import { litellmReadRefusal, openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Routes (Admin, org-admin, Auditor; 403 before input parsing, Rule
// 10.3), The computation (Organisation), Visibility (a global reader sees
// show or warn, never hidden), States (LD37, LD21, 503), LiteLLM reads used
// (the LD33 teams total; no new operation). The gateway config is read per
// request (LT33); the Bedrock routes are unchanged (LD38).

export const dynamic = "force-dynamic";

export const GET = withRoute(async (request, _ctx, session) => {
  const refused = openModeRefusal() ?? (await litellmReadRefusal(session));
  if (refused) return refused;
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  return liteLLMResponse(async () => {
    const [gateway, configured, enabled] = await Promise.all([
      loadGateway(),
      isLiteLLMConfigured(),
      enabledOperations(),
    ]);
    requireEnabled(enabled, ["listProxyTeams", "getTeamDailySpend"]);
    const rollups = await loadRangeRollups(dateFrom, dateTo);
    const litellm = configured
      ? await readOrganisationSide({ startDate: dateFrom, endDate: dateTo })
      : ({ kind: "not-configured" } as const);
    return jsonData(
      CombinedOrganisationResponseSchema.parse({
        visibility: combinedVisibility(true, gateway.configured),
        configured,
        gatewayConfigured: gateway.configured,
        ...computeOrganisation({ rollups, gateway, litellm }),
      }),
    );
  });
});
