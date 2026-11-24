import { InviteCandidateSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { IdParamSchema } from "@/lib/api/id-param";
import { findMemberInvite } from "@/lib/api/invite-accept";
import {
  annotateKeyCandidates,
  annotateSearchRows,
} from "@/lib/api/invite-candidate-signal";
import { loadManager, notFoundResponse } from "@/lib/api/matrix-route";
import { findTeam } from "@/lib/api/org-lookup";
import {
  jsonData,
  jsonError,
  parseInput,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import {
  decideWrite,
  isMatrixWriter,
  mayAttempt,
} from "@/lib/auth/write-policy";
import {
  listInviteCandidates,
  searchInviteDirectory,
} from "@/lib/data/access/pending";

// Source: docs/specs/2026-11-10-access-control.md - "Accept a pending invite
// (unit INV1)" (Target, Details), "API routes" (GET .../candidates: `?q=` for
// internal-admin and internal-org-admin only; at most 10 rows). A read: no
// audit record. The same gate as the accept write.
type CandidatesContext = { params: Promise<{ id: string; key: string }> };

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
});

const handler = withRoute(async (request, ctx, session) => {
  const params = await ctx.params;
  const actor = await loadManager(session);
  if (!actor || !mayAttempt(actor, "member")) {
    return jsonError(403, "FORBIDDEN", "Insufficient permission");
  }
  const teamId = parseInput(params.id, IdParamSchema);
  const key = parseInput(params.key, IdParamSchema).toLowerCase();
  const { q } = parseSearchParams(request, QuerySchema);
  const team = await findTeam(teamId);
  if (decideWrite(actor, { operation: "member", team }) !== "allow") {
    return notFoundResponse();
  }
  if (!(await findMemberInvite(teamId, key))) return notFoundResponse();
  const rows =
    q !== undefined && isMatrixWriter(actor.roles)
      ? annotateSearchRows(await searchInviteDirectory(q))
      : await annotateKeyCandidates(await listInviteCandidates(key), key);
  return jsonData({ items: z.array(InviteCandidateSchema).parse(rows) });
});

export const GET = (request: Request, ctx: CandidatesContext) =>
  handler(request, ctx);
