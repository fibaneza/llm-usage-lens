import {
  CombinedMeResponseSchema,
  DateRangeQuerySchema,
} from "@llm-usage-lens/shared";

import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { ownUsageKeys } from "@/lib/api/me";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { scopeFor } from "@/lib/api/scoped-rollups";
import { isLiteLLMConfigured } from "@/lib/litellm/client";
import { combinedVisibility, computePerson } from "@/lib/litellm/combined";
import type { LiteLLMSide } from "@/lib/litellm/combined";
import {
  loadGateway,
  readPersonSide,
  resolveOwnLiteLLMUserId,
} from "@/lib/litellm/combined-data";
import {
  enabledOperations,
  isOrgWideReader,
  liteLLMResponse,
  requireEnabled,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Routes (any signed-in role, own data, never capped: LT31),
// The computation (Person: the caller's own usage keys), Visibility (global
// readers show or warn; everyone else show or hidden, applied here so a hidden
// body carries no figure: LT29, LT32), States, LiteLLM reads used (paged;
// the cap is a 503); shared contract 5.

export const dynamic = "force-dynamic";

export const GET = withRoute(async (request, _ctx, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  return liteLLMResponse(async () => {
    const [gateway, configured, globalReader] = await Promise.all([
      loadGateway(),
      isLiteLLMConfigured(),
      isOrgWideReader(session),
    ]);
    const visibility = combinedVisibility(globalReader, gateway.configured);
    if (visibility === "hidden") {
      return jsonData(
        CombinedMeResponseSchema.parse({
          visibility,
          configured,
          gatewayConfigured: false,
        }),
      );
    }
    const [rollups, scope] = await Promise.all([
      loadRangeRollups(dateFrom, dateTo),
      scopeFor(session, []),
    ]);
    const enabled = await enabledOperations();
    requireEnabled(enabled, ["getUserDailySpend"]);
    let litellm: LiteLLMSide = { kind: "not-configured" };
    if (configured) {
      const litellmUserId = await resolveOwnLiteLLMUserId(session, enabled);
      if (litellmUserId === null) {
        litellm = { kind: "no-user" };
      } else {
        litellm = await readPersonSide(litellmUserId, {
          startDate: dateFrom,
          endDate: dateTo,
        });
      }
    }
    return jsonData(
      CombinedMeResponseSchema.parse({
        visibility,
        configured,
        gatewayConfigured: gateway.configured,
        ...computePerson({
          rollups,
          gateway,
          usageKeys: ownUsageKeys(scope, session.user.email),
          litellm,
        }),
      }),
    );
  });
});
