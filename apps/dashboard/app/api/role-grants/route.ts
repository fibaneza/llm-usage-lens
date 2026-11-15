import { RoleGrantSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { accessErrorResponse, listOptions } from "@/lib/api/access-route";
import { jsonData, withRoute } from "@/lib/api/respond";
import { listRoleGrants } from "@/lib/data/access/role-grants";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)":
// GET internal-admin or internal-auditor. POST and DELETE need re-auth and
// ship in a later slice.
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
