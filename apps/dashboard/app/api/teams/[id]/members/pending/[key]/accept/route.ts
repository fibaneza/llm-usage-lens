import {
  AcceptInviteBodySchema,
  MemberAffiliationSchema,
} from "@llm-usage-lens/shared";

import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { IdParamSchema } from "@/lib/api/id-param";
import { findMemberInvite } from "@/lib/api/invite-accept";
import { appEnv, matrixWrite, notFoundResponse } from "@/lib/api/matrix-route";
import { findTeam } from "@/lib/api/org-lookup";
import {
  jsonData,
  jsonError,
  parseInput,
  parseJsonBody,
  recordDeniedWrite,
} from "@/lib/api/respond";
import { resolveGlobalRoles } from "@/lib/auth/roles";
import { isMatrixWriter } from "@/lib/auth/write-policy";
import { getAffiliation } from "@/lib/data/access/affiliations";
import { loadGrantedRoles } from "@/lib/data/access/authorization";
import {
  acceptPendingInvite,
  findTenantIdentity,
  listInviteCandidates,
} from "@/lib/data/access/pending";

// Source: docs/specs/2026-11-10-access-control.md - "Accept a pending invite
// (unit INV1)" (Who, Target, Refusals, Write, Details), "API routes", threats
// T-INV1 to T-INV6. Check order: permission (403 before parsing), body, self
// accept, the pending member item, the candidate check for a lead, the
// privileged target, then the bind on the stored version.
type AcceptContext = { params: Promise<{ id: string; key: string }> };

const PRIVILEGED = [
  "internal-admin",
  "internal-org-admin",
  "internal-auditor",
] as const;

const DENIED = {
  action: "affiliation.invite.accept",
  pattern: "/api/teams/[id]/members/pending/[key]/accept",
} as const;

const handler = matrixWrite(
  { operation: "member", ...DENIED },
  async ({ request, params, session, actor, refuse }) => {
    const teamId = parseInput(params.id, IdParamSchema);
    const team = await findTeam(teamId);
    const refusal = await refuse({ operation: "member", team });
    if (refusal) return refusal;
    const key = parseInput(params.key, IdParamSchema).toLowerCase();
    const body = await parseJsonBody(request, AcceptInviteBodySchema);
    if (body.oid === session.user.oid) {
      await recordDeniedWrite(request, session.user.oid, DENIED);
      return jsonError(403, "FORBIDDEN", "You cannot accept your own invite");
    }

    const invite = await findMemberInvite(teamId, key);
    if (!invite) {
      // A replay: the invite is gone and the target already sits in this team.
      const current = await getAffiliation(body.oid);
      return current?.teamId === teamId
        ? accessErrorResponse("CONFLICT")
        : notFoundResponse();
    }

    // A lead's probe is judged by the candidate set first, so an unknown,
    // foreign-tenant or non-candidate oid is indistinguishable (R2-B1).
    if (!isMatrixWriter(actor.roles)) {
      const candidates = await listInviteCandidates(key);
      if (!candidates.some((c) => c.oid === body.oid)) {
        await recordDeniedWrite(request, session.user.oid, DENIED, "NOT_FOUND");
        return notFoundResponse();
      }
    }
    const identity = await findTenantIdentity(body.oid);
    if (!identity) return notFoundResponse();

    const held = new Set<string>([
      ...(resolveGlobalRoles(identity.lastSeenRoles, appEnv()) ?? []),
      ...(await loadGrantedRoles(body.oid)),
    ]);
    if (PRIVILEGED.some((role) => held.has(role))) {
      await recordDeniedWrite(
        request,
        session.user.oid,
        DENIED,
        "PRIVILEGED_TARGET",
      );
      return jsonError(
        409,
        "PRIVILEGED_TARGET",
        "The target holds a privileged role",
      );
    }

    const result = await acceptPendingInvite(
      {
        emailOrUpn: key,
        teamId,
        version: invite.version,
        oid: body.oid,
        reason: body.reason,
      },
      auditContext(session),
    );
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(MemberAffiliationSchema.parse(result.value), {
      status: 201,
    });
  },
);

export const POST = (request: Request, ctx: AcceptContext) =>
  handler(request, ctx);
