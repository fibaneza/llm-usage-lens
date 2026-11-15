import {
  PasswordUserInputSchema,
  PasswordUserListItemSchema,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import {
  accessErrorResponse,
  auditContext,
  listOptions,
} from "@/lib/api/access-route";
import { setupLink, userResponse } from "@/lib/api/password-user-route";
import { jsonData, parseJsonBody, withRoute } from "@/lib/api/respond";
import {
  createPasswordUser,
  listPasswordUsers,
} from "@/lib/data/access/password-users";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)":
// GET internal-admin or internal-auditor; POST internal-admin. "Password
// users" (Setup D22): the setup link is in this one response only.
export const GET = withRoute(
  async (request) => {
    const result = await listPasswordUsers(listOptions(request));
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData({
      items: z.array(PasswordUserListItemSchema).parse(result.value.items),
      ...(result.value.cursor ? { cursor: result.value.cursor } : {}),
    });
  },
  { requireAdminOrAuditor: true },
);

export const POST = withRoute(
  async (request, _ctx, session) => {
    const input = await parseJsonBody(request, PasswordUserInputSchema);
    const result = await createPasswordUser(input, auditContext(session));
    if (!result.ok) return accessErrorResponse(result.code);
    return userResponse(
      result.value.user.email,
      { setupLink: setupLink(request, result.value.setupToken) },
      { status: 201 },
    );
  },
  {
    requireAdmin: true,
    requireRecentAuth: true,
    denied: { action: "localuser.create", pattern: "/api/password-users" },
  },
);
