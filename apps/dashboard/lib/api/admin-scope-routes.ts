import "server-only";

import {
  AdminScopeRowSchema,
  AdminScopeSchema,
  PendingItemSchema,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import {
  accessErrorResponse,
  auditContext,
  listOptions,
} from "@/lib/api/access-route";
import { IdParamSchema } from "@/lib/api/id-param";
import {
  VersionBodySchema,
  isPendingKey,
  personBodySchema,
} from "@/lib/api/matrix-input";
import {
  loadManager,
  matrixWrite,
  notFoundResponse,
} from "@/lib/api/matrix-route";
import { findDepartment, findTeam } from "@/lib/api/org-lookup";
import {
  jsonData,
  parseInput,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { canManageRead } from "@/lib/auth/write-policy";
import type { MatrixTarget } from "@/lib/auth/write-policy";
import {
  grantAdminScope,
  listScopeAdmins,
  revokeAdminScope,
} from "@/lib/data/access/admin-scopes";
import { identityExists, withPersonNames } from "@/lib/data/access/identities";
import {
  createPendingItem,
  deletePendingItem,
  listPendingFor,
} from "@/lib/data/access/pending";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/teams/[id]/admins and /api/departments/[id]/admins GET, POST; .../[oid]
// DELETE: per matrix), "Permission matrix" (team-scope grants: a team-scope
// admin never on their own scope; department-scope grants: internal-admin and
// internal-org-admin only), "Identity, SSO mapping and defaults" (SSO > UI).
// The team and department routes differ only in the scope they address.
export function adminScopeHandlers(scopeType: "team" | "department") {
  const base =
    scopeType === "team"
      ? "/api/teams/[id]/admins"
      : "/api/departments/[id]/admins";

  async function targetOf(
    id: string,
    subjectOid?: string,
  ): Promise<MatrixTarget> {
    if (scopeType === "team") {
      return {
        operation: "team-admin",
        team: await findTeam(id),
        ...(subjectOid !== undefined ? { subjectOid } : {}),
      };
    }
    return {
      operation: "department-admin",
      departmentId: await findDepartment(id),
    };
  }

  const list = withRoute(async (request, ctx, session) => {
    const id = parseInput((await ctx.params).id, IdParamSchema);
    const actor = await loadManager(session);
    const readable =
      scopeType === "team"
        ? { team: await findTeam(id) }
        : { departmentId: await findDepartment(id) };
    if (!actor || !canManageRead(actor, readable)) return notFoundResponse();
    const result = await listScopeAdmins(
      { scopeType, scopeId: id },
      listOptions(request),
    );
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData({
      items: z
        .array(AdminScopeRowSchema)
        .parse(await withPersonNames(result.value.items)),
      ...(result.value.cursor ? { cursor: result.value.cursor } : {}),
    });
  });

  const grant = matrixWrite(
    {
      operation: scopeType === "team" ? "team-admin" : "department-admin",
      action: "adminscope.grant",
      pattern: base,
    },
    async ({ request, params, session, refuse }) => {
      const id = parseInput(params.id, IdParamSchema);
      const refusal = await refuse(await targetOf(id));
      if (refusal) return refusal;
      const person = await parseJsonBody(
        request,
        personBodySchema({
          key: scopeType === "team" ? "teamId" : "departmentId",
          value: id,
        }),
      );
      const own = await refuse(
        await targetOf(id, "oid" in person ? person.oid : undefined),
      );
      if (own) return own;
      const ctx = auditContext(session);
      if ("emailOrUpn" in person) {
        const result = await createPendingItem(
          {
            kind: "adminScope",
            emailOrUpn: person.emailOrUpn,
            scopeType,
            scopeId: id,
          },
          ctx,
        );
        if (!result.ok) return accessErrorResponse(result.code);
        return jsonData(PendingItemSchema.parse(result.value), { status: 201 });
      }
      if (!(await identityExists(person.oid))) return notFoundResponse();
      const result = await grantAdminScope(
        { oid: person.oid, scopeType, scopeId: id },
        ctx,
      );
      if (!result.ok) return accessErrorResponse(result.code);
      return jsonData(AdminScopeSchema.parse(result.value), { status: 201 });
    },
  );

  const revoke = matrixWrite(
    {
      operation: scopeType === "team" ? "team-admin" : "department-admin",
      action: "adminscope.revoke",
      pattern: `${base}/[oid]`,
    },
    async ({ request, params, session, refuse }) => {
      const id = parseInput(params.id, IdParamSchema);
      const key = parseInput(params.oid, IdParamSchema);
      const refusal = await refuse(
        await targetOf(id, isPendingKey(key) ? undefined : key),
      );
      if (refusal) return refusal;
      const { version } = await parseJsonBody(request, VersionBodySchema);
      const ctx = auditContext(session);
      if (isPendingKey(key)) {
        const item = (await listPendingFor([key])).find(
          (p) =>
            p.kind === "adminScope" &&
            p.scopeType === scopeType &&
            p.scopeId === id,
        );
        if (!item) return notFoundResponse();
        const result = await deletePendingItem({ item, version }, ctx);
        if (!result.ok) return accessErrorResponse(result.code);
        return jsonData({ oid: key, scopeType, scopeId: id });
      }
      const result = await revokeAdminScope(
        { oid: key, scopeType, scopeId: id, version },
        ctx,
      );
      if (!result.ok) return accessErrorResponse(result.code);
      return jsonData({ oid: key, scopeType, scopeId: id });
    },
  );

  return { list, grant, revoke };
}
