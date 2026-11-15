import { MemberAffiliationSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { IdParamSchema } from "@/lib/api/id-param";
import { matrixWrite } from "@/lib/api/matrix-route";
import { findTeam } from "@/lib/api/org-lookup";
import { jsonData, parseInput, parseJsonBody } from "@/lib/api/respond";
import { moveMember } from "@/lib/data/access/affiliations";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (POST /api/affiliations/[oid]/move { fromTeamId, toTeamId, version }: per
// matrix), "Mover" (authority over both teams; one atomic transaction that also
// removes the source team-scope admin; SSO-sourced: 409 MANAGED_BY_SSO).
type MoveContext = { params: Promise<{ oid: string }> };

const MoveBodySchema = z.object({
  fromTeamId: IdParamSchema,
  toTeamId: IdParamSchema,
  version: z.number().int().min(1),
});

const postHandler = matrixWrite(
  {
    operation: "move",
    action: "affiliation.move",
    pattern: "/api/affiliations/[oid]/move",
  },
  async ({ request, params, session, refuse }) => {
    const oid = parseInput(params.oid, IdParamSchema);
    // The authority depends on the two teams, so the body is read first.
    const body = await parseJsonBody(request, MoveBodySchema);
    const [from, to] = await Promise.all([
      findTeam(body.fromTeamId),
      findTeam(body.toTeamId),
    ]);
    const refusal = await refuse({ operation: "move", from, to });
    if (refusal) return refusal;
    const result = await moveMember({ oid, ...body }, auditContext(session));
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(MemberAffiliationSchema.parse(result.value));
  },
);

export const POST = (request: Request, ctx: MoveContext) =>
  postHandler(request, ctx);
