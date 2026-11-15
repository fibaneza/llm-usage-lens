import {
  MemberAffiliationSchema,
  MemberRowSchema,
  PendingItemSchema,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import {
  accessErrorResponse,
  auditContext,
  listOptions,
} from "@/lib/api/access-route";
import { IdParamSchema } from "@/lib/api/id-param";
import { personBodySchema } from "@/lib/api/matrix-input";
import {
  loadManager,
  matrixWrite,
  notFoundResponse,
} from "@/lib/api/matrix-route";
import { findTeam } from "@/lib/api/org-lookup";
import {
  jsonData,
  parseInput,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { canManageRead } from "@/lib/auth/write-policy";
import { addMember, listTeamMembers } from "@/lib/data/access/affiliations";
import { identityExists, withPersonNames } from "@/lib/data/access/identities";
import { createPendingItem } from "@/lib/data/access/pending";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/teams/[id]/members GET, POST: per matrix), "Permission matrix" (add an
// unaffiliated user or pending email/UPN), "Membership, admin scopes and
// lifecycle" (one team per member: 409 ALREADY_AFFILIATED; Joiner: pending
// item by email/UPN).
type TeamContext = { params: Promise<{ id: string }> };

const getHandler = withRoute(async (request, ctx, session) => {
  const teamId = parseInput((await ctx.params).id, IdParamSchema);
  const actor = await loadManager(session);
  const team = await findTeam(teamId);
  if (!actor || !canManageRead(actor, { team })) return notFoundResponse();
  const result = await listTeamMembers(teamId, listOptions(request));
  if (!result.ok) return accessErrorResponse(result.code);
  return jsonData({
    items: z
      .array(MemberRowSchema)
      .parse(await withPersonNames(result.value.items)),
    ...(result.value.cursor ? { cursor: result.value.cursor } : {}),
  });
});

const postHandler = matrixWrite(
  {
    operation: "member",
    action: "affiliation.add",
    pattern: "/api/teams/[id]/members",
  },
  async ({ request, params, session, refuse }) => {
    const teamId = parseInput(params.id, IdParamSchema);
    const team = await findTeam(teamId);
    const refusal = await refuse({ operation: "member", team });
    if (refusal) return refusal;
    const person = await parseJsonBody(
      request,
      personBodySchema({ key: "teamId", value: teamId }),
    );
    const ctx = auditContext(session);
    if ("emailOrUpn" in person) {
      const result = await createPendingItem(
        { kind: "affiliation", emailOrUpn: person.emailOrUpn, teamId },
        ctx,
      );
      if (!result.ok) return accessErrorResponse(result.code);
      return jsonData(PendingItemSchema.parse(result.value), { status: 201 });
    }
    if (!(await identityExists(person.oid))) return notFoundResponse();
    const result = await addMember({ oid: person.oid, teamId }, ctx);
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(MemberAffiliationSchema.parse(result.value), {
      status: 201,
    });
  },
);

export const GET = (request: Request, ctx: TeamContext) =>
  getHandler(request, ctx);
export const POST = (request: Request, ctx: TeamContext) =>
  postHandler(request, ctx);
