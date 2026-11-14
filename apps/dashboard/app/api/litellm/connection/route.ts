import { randomUUID } from "node:crypto";

import {
  LiteLLMConnectionStatusSchema,
  liteLLMEdition,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import { auth } from "@/auth";
import { env } from "@/env";
import {
  jsonData,
  jsonError,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { hasAdminRole, hasGlobalRole } from "@/lib/auth/roles";
import {
  getLiteLLMConnection,
  putLiteLLMConnection,
} from "@/lib/data/litellm/connection";
import {
  allowedHostsFromEnv,
  isServiceKeyConfigured,
} from "@/lib/litellm/client";
import { validateLiteLLMBaseUrl } from "@/lib/litellm/base-url";
import { testLiteLLMConnection } from "@/lib/litellm/connection-test";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (GET Admin +
// Auditor, PUT Admin) and "Security architecture" items 5-8: the candidate URL
// is tested before it is saved; a failed test saves and audits nothing.

export const dynamic = "force-dynamic";

const PutBodySchema = z.strictObject({
  baseUrl: z.string(),
  version: z.number().int().min(1).nullable(),
});

function status(baseUrl: string | null, version: number) {
  return LiteLLMConnectionStatusSchema.parse({
    baseUrl,
    version,
    edition: liteLLMEdition(env.APP_ENV),
    serviceKeyConfigured: isServiceKeyConfigured(),
  });
}

export const GET = withRoute(async () => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const session = await auth();
  if (!hasAdminRole(session) && !hasGlobalRole(session, "internal-auditor")) {
    return jsonError(403, "FORBIDDEN", "Admin or Auditor role required");
  }
  const connection = await getLiteLLMConnection();
  return jsonData(
    status(connection?.baseUrl ?? null, connection?.version ?? 0),
  );
});

export const PUT = withRoute(
  async (request) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    const input = await parseJsonBody(request, PutBodySchema);
    const checked = validateLiteLLMBaseUrl(input.baseUrl, {
      allowedHosts: allowedHostsFromEnv(),
      appEnv: env.APP_ENV,
    });
    if (!checked.ok) return jsonError(400, "BAD_REQUEST", checked.reason);

    const session = await auth();
    if (!session) return jsonError(401, "UNAUTHORIZED", "Sign in required");

    const test = await testLiteLLMConnection(checked.baseUrl);
    if (test.result !== "ok") {
      return jsonError(503, "LITELLM_UNAVAILABLE", test.message);
    }

    const saved = await putLiteLLMConnection(
      { baseUrl: checked.baseUrl, version: input.version },
      {
        actor: session.user.oid,
        requestId: randomUUID(),
        now: new Date(),
        sequence: { next: 0 },
      },
    );
    if (!saved.ok) {
      return jsonError(409, "CONFLICT", "The connection was changed; reload");
    }
    return jsonData(status(saved.value.baseUrl, saved.value.version));
  },
  {
    requireAdmin: true,
    denied: {
      action: "litellm.connection.update",
      pattern: "/api/litellm/connection",
    },
  },
);
