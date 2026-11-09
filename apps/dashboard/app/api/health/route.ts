import { HealthResponseSchema } from "@llm-usage-lens/shared";

import type { RouteContext } from "@/lib/api/respond";
import { checkDynamoDb } from "@/lib/data/health";

// Source: docs/specs/2026-11-10-access-control.md — "API routes" and
// docs/specs/2026-11-10-platform.md — "Runtime / Health check". The one route
// that serves without a session (Rule 10.3 exception): no data, no internals.
// Always 200 while the process serves so a DynamoDB outage does not make ECS
// replace every task; the body reports "degraded".
export const dynamic = "force-dynamic";

export const GET: (
  request: Request,
  ctx: RouteContext,
) => Promise<Response> = async () => {
  const dynamodb = await checkDynamoDb();
  const body = HealthResponseSchema.parse({
    data: {
      status: dynamodb === "ok" ? "ok" : "degraded",
      dependencies: { dynamodb, litellm: "not-configured" },
    },
  });
  return Response.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
};
