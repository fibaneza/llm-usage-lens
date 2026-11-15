import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { IdParamSchema } from "@/lib/api/id-param";
import { VersionBodySchema, isPendingKey } from "@/lib/api/matrix-input";
import { matrixWrite, notFoundResponse } from "@/lib/api/matrix-route";
import { findTeam } from "@/lib/api/org-lookup";
import { jsonData, parseInput, parseJsonBody } from "@/lib/api/respond";
import { removeMember } from "@/lib/data/access/affiliations";
import { deletePendingItem, listPendingFor } from "@/lib/data/access/pending";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/teams/[id]/members/[oid] DELETE: per matrix), "Permission matrix"
// (remove a member), "Identity, SSO mapping and defaults" (SSO > UI: 409
// MANAGED_BY_SSO). The path key is an `oid`, or a pending member's address.
type MemberContext = { params: Promise<{ id: string; oid: string }> };

const deleteHandler = matrixWrite(
  {
    operation: "member",
    action: "affiliation.remove",
    pattern: "/api/teams/[id]/members/[oid]",
  },
  async ({ request, params, session, refuse }) => {
    const teamId = parseInput(params.id, IdParamSchema);
    const key = parseInput(params.oid, IdParamSchema);
    const team = await findTeam(teamId);
    const refusal = await refuse({ operation: "member", team });
    if (refusal) return refusal;
    const { version } = await parseJsonBody(request, VersionBodySchema);
    const ctx = auditContext(session);

    if (isPendingKey(key)) {
      const item = (await listPendingFor([key])).find(
        (p) => p.kind === "affiliation" && p.teamId === teamId,
      );
      if (!item) return notFoundResponse();
      const result = await deletePendingItem({ item, version }, ctx);
      if (!result.ok) return accessErrorResponse(result.code);
      return jsonData({ oid: key, teamId });
    }
    const result = await removeMember({ oid: key, teamId, version }, ctx);
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData({ oid: key, teamId });
  },
);

export const DELETE = (request: Request, ctx: MemberContext) =>
  deleteHandler(request, ctx);
