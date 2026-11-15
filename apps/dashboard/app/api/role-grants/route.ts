import { GrantableRoleSchema, RoleGrantSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import {
  accessErrorResponse,
  auditContext,
  listOptions,
} from "@/lib/api/access-route";
import { jsonData, parseJsonBody, withRoute } from "@/lib/api/respond";
import { grantRole, listRoleGrants } from "@/lib/data/access/role-grants";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)":
// GET internal-admin or internal-auditor; POST internal-admin with recent
// authentication (D28).
export const GET = withRoute(
  async (request) => {
    const result = await listRoleGrants(listOptions(request));
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData({
      items: z.array(RoleGrantSchema).parse(result.value.items),
      ...(result.value.cursor ? { cursor: result.value.cursor } : {}),
    });
  },
  { requireAdminOrAuditor: true },
);

const GrantInputSchema = z.object({
  oid: z.string().min(1).max(128),
  role: GrantableRoleSchema,
  reason: z.string().min(1).max(500),
});

export const POST = withRoute(
  async (request, _ctx, session) => {
    const input = await parseJsonBody(request, GrantInputSchema);
    const result = await grantRole(input, auditContext(session));
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(RoleGrantSchema.parse(result.value), { status: 201 });
  },
  {
    requireAdmin: true,
    requireRecentAuth: true,
    denied: { action: "role.grant", pattern: "/api/role-grants" },
  },
);
