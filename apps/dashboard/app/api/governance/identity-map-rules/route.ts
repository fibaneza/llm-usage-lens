import { IdentityMapRuleListSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { jsonData, parseJsonBody, withRoute } from "@/lib/api/respond";
import {
  getIdentityMapRules,
  setIdentityMapRules,
} from "@/lib/data/access/identity-map-rules";

// Source: docs/specs/2026-11-10-access-control.md - "Usage-identity mapping
// rules (D27)": GET internal-admin or internal-auditor, PUT internal-admin;
// the route is derived from D27 (the API list names none). The PUT replaces
// the whole ordered list at the stored version.
const BodySchema = z.object({
  rules: IdentityMapRuleListSchema,
  version: z.number().int().min(0),
});

export const GET = withRoute(
  async () => {
    const stored = await getIdentityMapRules();
    return jsonData(stored ?? { rules: [], version: 0 });
  },
  { requireAdminOrAuditor: true },
);

export const PUT = withRoute(
  async (request, _ctx, session) => {
    const body = await parseJsonBody(request, BodySchema);
    const result = await setIdentityMapRules(body, auditContext(session));
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(result.value);
  },
  {
    requireAdmin: true,
    denied: {
      action: "identity.map.update",
      pattern: "/api/governance/identity-map-rules",
    },
  },
);
