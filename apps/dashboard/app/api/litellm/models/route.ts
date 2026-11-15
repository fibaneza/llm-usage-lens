import { LiteLLMModelsResponseSchema } from "@llm-usage-lens/shared";

import { jsonData, jsonError, withRoute } from "@/lib/api/respond";
import { globalRolesOf, resolveScope } from "@/lib/auth/policy";
import { listProxyModels } from "@/lib/litellm/operations";
import { liteLLMResponse } from "@/lib/litellm/read-views";
import { authorizationFor, openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/models
// GET: Lead, Admin), "Reads" (listProxyModels: return_wildcard_routes=false),
// "Roles and rights" (Lead = any admin scope or internal-org-admin; Auditor
// and Viewer have no model list). The route has no team id to hide, so a
// refusal is 403 FORBIDDEN, not 404.

export const dynamic = "force-dynamic";

export const GET = withRoute(async (_request, _ctx, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const input = await authorizationFor(session);
  const roles = globalRolesOf(session, input.appEnv, input.roleGrants) ?? [];
  if (
    !roles.includes("internal-admin") &&
    !roles.includes("internal-org-admin")
  ) {
    const scope = resolveScope(input);
    if (scope.teamScopes.size === 0 && scope.departmentScopes.size === 0) {
      return jsonError(403, "FORBIDDEN", "Team admin or Admin role required");
    }
  }
  return liteLLMResponse(async () => {
    const res = await listProxyModels();
    return jsonData(
      LiteLLMModelsResponseSchema.parse({ items: res.data.map((m) => m.id) }),
    );
  });
});
