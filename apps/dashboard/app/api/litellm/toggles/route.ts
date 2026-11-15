import { randomUUID } from "node:crypto";

import {
  LiteLLMOperationNameSchema,
  liteLLMEdition,
} from "@llm-usage-lens/shared";
import type {
  OperationToggles,
  OperationTogglesView,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import { env } from "@/env";
import {
  jsonData,
  jsonError,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import {
  getOperationToggles,
  putOperationToggles,
  resetOperationToggles,
} from "@/lib/data/litellm/toggles";
import { loadGatewayConfig } from "@/lib/litellm/gateway-config";
import { resolveOperationSettings } from "@/lib/litellm/operation-settings";
import {
  adminOrAuditorRefusal,
  openModeRefusal,
} from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (GET Admin +
// Auditor, PUT Admin), "Toggles narrow only" (DynamoDB, versioned, audited;
// names outside the allowlist are refused), "Guardrail configuration" (each
// operation's effective value and its source ui | file | spec; "reset to file
// defaults" is Admin, audited and versioned like any toggle write). A toggle
// write is dashboard-only: no LiteLLM call.

export const dynamic = "force-dynamic";

const PutBodySchema = z.union([
  z.strictObject({
    version: z.number().int().min(1).nullable(),
    toggles: z
      .partialRecord(LiteLLMOperationNameSchema, z.boolean())
      .refine((t) => Object.keys(t).length > 0, "No toggles given"),
  }),
  z.strictObject({
    version: z.number().int().min(1),
    reset: z.literal(true),
  }),
]);

function view(saved: OperationToggles | null): OperationTogglesView {
  const file = loadGatewayConfig();
  return {
    version: saved?.version ?? 0,
    edition: liteLLMEdition(env.APP_ENV),
    operations: resolveOperationSettings({
      file,
      saved: saved?.toggles ?? null,
    }),
  };
}

export const GET = withRoute(async (_request, _ctx, session) => {
  const refused = openModeRefusal() ?? adminOrAuditorRefusal(session);
  if (refused) return refused;
  return jsonData(view(await getOperationToggles()));
});

export const PUT = withRoute(
  async (request, _ctx, session) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    const input = await parseJsonBody(request, PutBodySchema);
    const ctx = {
      actor: session.user.oid,
      requestId: randomUUID(),
      now: new Date(),
      sequence: { next: 0 },
    };
    const saved =
      "reset" in input
        ? await resetOperationToggles({ version: input.version }, ctx)
        : await putOperationToggles(input, ctx);
    if (!saved.ok) {
      return jsonError(409, "CONFLICT", "The toggles were changed; reload");
    }
    return jsonData(view(saved.value));
  },
  {
    requireAdmin: true,
    denied: {
      action: "litellm.toggles.update",
      pattern: "/api/litellm/toggles",
    },
  },
);
