import { z } from "zod";

import { accessErrorResponse, listOptions } from "@/lib/api/access-route";
import { jsonData, withRoute } from "@/lib/api/respond";
import {
  IdentityListItemSchema,
  listIdentities,
} from "@/lib/data/access/identities";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)":
// /api/identities GET, internal-admin or internal-auditor.
export const GET = withRoute(
  async (request) => {
    const result = await listIdentities(listOptions(request));
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData({
      items: z.array(IdentityListItemSchema).parse(result.value.items),
      ...(result.value.cursor ? { cursor: result.value.cursor } : {}),
    });
  },
  { requireAdminOrAuditor: true },
);
