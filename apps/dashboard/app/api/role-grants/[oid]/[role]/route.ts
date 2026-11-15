import { GrantableRoleSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import {
  accessErrorResponse,
  auditContext,
  cursorSecret,
} from "@/lib/api/access-route";
import {
  jsonData,
  jsonError,
  parseInput,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { listRoleGrants, revokeRole } from "@/lib/data/access/role-grants";

// Source: docs/specs/2026-11-10-access-control.md - "Roles" (the last in-app
// internal-admin grant cannot be revoked: 409), "API routes (additions)" and
// "Recent authentication" (D28).
const VersionSchema = z.object({ version: z.number().int().min(1) });
const OidSchema = z.string().min(1).max(128);
const PATTERN = "/api/role-grants/[oid]/[role]";

// The lowest-oid internal-admin grant other than this one (deterministic), or
// null. Paginates the whole list.
async function otherAdminGrantOid(oid: string): Promise<string | null> {
  let cursor: string | undefined;
  let other: string | null = null;
  do {
    const result = await listRoleGrants({
      cursorSecret: cursorSecret(),
      ...(cursor ? { cursor } : {}),
    });
    if (!result.ok) throw new Error("role grant list failed");
    for (const g of result.value.items) {
      if (g.role === "internal-admin" && g.oid !== oid) {
        if (other === null || g.oid < other) other = g.oid;
      }
    }
    cursor = result.value.cursor;
  } while (cursor);
  return other;
}

const deleteHandler = withRoute(
  async (request, ctx, session) => {
    const params = await ctx.params;
    const oid = parseInput(params.oid, OidSchema);
    const role = parseInput(params.role, GrantableRoleSchema);
    const { version } = await parseJsonBody(request, VersionSchema);
    const otherAdminOid =
      role === "internal-admin" ? await otherAdminGrantOid(oid) : null;
    if (role === "internal-admin" && otherAdminOid === null) {
      return jsonError(
        409,
        "CONFLICT",
        "The last internal-admin grant cannot be revoked",
      );
    }
    const result = await revokeRole(
      { oid, role, version, ...(otherAdminOid ? { otherAdminOid } : {}) },
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
