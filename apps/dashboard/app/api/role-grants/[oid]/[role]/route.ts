import { GrantableRoleSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import {
  jsonData,
  jsonError,
  parseInput,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import {
  findOtherActiveAdmin,
  revokeRole,
  roleGrantExists,
} from "@/lib/data/access/role-grants";

// Source: docs/specs/2026-11-10-access-control.md - "Roles" (the last in-app
// internal-admin grant that can still sign in cannot be revoked: 409), "API routes (additions)" and
// "Recent authentication" (D28).
const VersionSchema = z.object({ version: z.number().int().min(1) });
const OidSchema = z.string().min(1).max(128);
const PATTERN = "/api/role-grants/[oid]/[role]";

const deleteHandler = withRoute(
  async (request, ctx, session) => {
    const params = await ctx.params;
    const oid = parseInput(params.oid, OidSchema);
    const role = parseInput(params.role, GrantableRoleSchema);
    const { version } = await parseJsonBody(request, VersionSchema);
    // A grant that is not there is NOT_FOUND before the last-admin guard.
    if (!(await roleGrantExists(oid, role))) {
      return accessErrorResponse("NOT_FOUND");
    }
    const other =
      role === "internal-admin" ? await findOtherActiveAdmin(oid) : null;
    if (role === "internal-admin" && other === null) {
      return jsonError(
        409,
        "CONFLICT",
        "The last internal-admin grant cannot be revoked",
      );
    }
    const result = await revokeRole(
      {
        oid,
        role,
        version,
        ...(other ? { otherAdminOid: other.oid } : {}),
        ...(other?.localUserEmail
          ? { otherAdminEmail: other.localUserEmail }
          : {}),
      },
      auditContext(session),
    );
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData({ oid, role });
  },
  {
    requireAdmin: true,
    requireRecentAuth: true,
    denied: { action: "role.revoke", pattern: PATTERN },
  },
);

type GrantContext = { params: Promise<{ oid: string; role: string }> };

export const DELETE = (request: Request, ctx: GrantContext) =>
  deleteHandler(request, ctx);
