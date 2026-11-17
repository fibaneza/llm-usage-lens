import { randomUUID } from "node:crypto";

import { BedrockGatewayPutSchema } from "@llm-usage-lens/shared";
import type {
  BedrockGatewayConfig,
  BedrockGatewayView,
} from "@llm-usage-lens/shared";

import {
  jsonData,
  jsonError,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import {
  getBedrockGateway,
  putBedrockGateway,
} from "@/lib/data/litellm/bedrock-gateway";
import { isGatewayConfigured } from "@/lib/litellm/combined";
import { litellmReadRefusal, openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6) -> Gateway configuration, Route" (GET Admin, org-admin, Auditor; PUT
// Admin only, 403 and one `denied` record otherwise; a stale version is 409;
// read per request, never cached: LT33, Rule 60.10), LT29, LT30. A dashboard-
// only configuration write: no LiteLLM call.

export const dynamic = "force-dynamic";

function view(config: BedrockGatewayConfig | null): BedrockGatewayView {
  if (!config) {
    return {
      gatewayConfigured: false,
      version: 0,
      principals: [],
      accountIds: [],
    };
  }
  return { gatewayConfigured: isGatewayConfigured(config), ...config };
}

export const GET = withRoute(async (_request, _ctx, session) => {
  const refused = openModeRefusal() ?? (await litellmReadRefusal(session));
  if (refused) return refused;
  return jsonData(view(await getBedrockGateway()));
});

export const PUT = withRoute(
  async (request, _ctx, session) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    const input = await parseJsonBody(request, BedrockGatewayPutSchema);
    const saved = await putBedrockGateway(input, {
      actor: session.user.oid,
      requestId: randomUUID(),
      now: new Date(),
      sequence: { next: 0 },
    });
    if (!saved.ok) {
      return saved.code === "NOT_FOUND"
        ? jsonError(400, "BAD_REQUEST", "Unknown account id")
        : jsonError(409, "CONFLICT", "The gateway was changed; reload");
    }
    return jsonData(view(saved.value));
  },
  {
    requireAdmin: true,
    denied: {
      action: "litellm.gateway.update",
      pattern: "/api/litellm/gateway",
    },
  },
);
