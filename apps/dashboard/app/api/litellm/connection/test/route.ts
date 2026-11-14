import { ConnectionTestResultSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { env } from "@/env";
import {
  jsonData,
  jsonError,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { validateLiteLLMBaseUrl } from "@/lib/litellm/base-url";
import { allowedHostsFromEnv } from "@/lib/litellm/client";
import { testLiteLLMConnection } from "@/lib/litellm/connection-test";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (POST Admin, not
// audited) and "Security architecture" item 6: tests the saved connection, or
// a candidate base URL from the body, without saving it.

export const dynamic = "force-dynamic";

const TestBodySchema = z.strictObject({ baseUrl: z.string().optional() });

export const POST = withRoute(
  async (request) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    const input = await parseJsonBody(request, TestBodySchema);
    let candidate: string | undefined;
    if (input.baseUrl !== undefined) {
      const checked = validateLiteLLMBaseUrl(input.baseUrl, {
        allowedHosts: allowedHostsFromEnv(),
        appEnv: env.APP_ENV,
      });
      if (!checked.ok) return jsonError(400, "BAD_REQUEST", checked.reason);
      candidate = checked.baseUrl;
    }
    return jsonData(
      ConnectionTestResultSchema.parse(await testLiteLLMConnection(candidate)),
    );
  },
  { requireAdmin: true },
);
