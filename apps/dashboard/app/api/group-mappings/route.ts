import {
  GroupMappingInputSchema,
  GroupMappingSchema,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import {
  GroupIdSchema,
  accessErrorResponse,
  auditContext,
  listOptions,
} from "@/lib/api/access-route";
import { jsonData, parseJsonBody, withRoute } from "@/lib/api/respond";
import {
  createGroupMapping,
  listGroupMappings,
} from "@/lib/data/access/group-mappings";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)":
// GET internal-admin or internal-auditor; POST internal-admin.
export const GET = withRoute(
  async (request) => {
    const result = await listGroupMappings(listOptions(request));
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData({
      items: z.array(GroupMappingSchema).parse(result.value.items),
      ...(result.value.cursor ? { cursor: result.value.cursor } : {}),
    });
  },
  { requireAdminOrAuditor: true },
);

const CreateSchema = GroupMappingInputSchema.and(
  z.object({ groupId: GroupIdSchema }),
);

export const POST = withRoute(
  async (request, _ctx, session) => {
    const input = await parseJsonBody(request, CreateSchema);
    const result = await createGroupMapping(input, auditContext(session));
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(GroupMappingSchema.parse(result.value), { status: 201 });
  },
  {
    requireAdmin: true,
    denied: { action: "groupmap.create", pattern: "/api/group-mappings" },
  },
);
