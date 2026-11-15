import { TeamVisibilitySchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { IdParamSchema } from "@/lib/api/id-param";
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
import { getVisibility, putTeamVisibility } from "@/lib/data/access/visibility";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/teams/[id]/visibility GET read in scope, PUT per matrix), "Visibility
// and inheritance" (defaults when nothing is stored, at version 0; a setting
// above the department cap is stored as given and applied as the cap),
// "Enforcement" item 6 (a body teamId must equal the path).
type TeamContext = { params: Promise<{ id: string }> };

const getHandler = withRoute(async (_request, ctx, session) => {
  const teamId = parseInput((await ctx.params).id, IdParamSchema);
  const actor = await loadManager(session);
  const team = await findTeam(teamId);
  if (!actor || !canManageRead(actor, { team })) return notFoundResponse();
  const { teams } = await getVisibility({
    teamIds: [teamId],
    departmentIds: [],
  });
  return jsonData(TeamVisibilitySchema.parse(teams.get(teamId)));
});

const levels = z.enum(["all", "own", "none"]);
const putHandler = matrixWrite(
  {
    operation: "team-visibility",
    action: "visibility.update",
    pattern: "/api/teams/[id]/visibility",
  },
  async ({ request, params, session, refuse }) => {
    const teamId = parseInput(params.id, IdParamSchema);
    const team = await findTeam(teamId);
    const refusal = await refuse({ operation: "team-visibility", team });
    if (refusal) return refusal;
    const body = await parseJsonBody(
      request,
      z
        .object({
          teamId: z.string().optional(),
          teamLevel: z.enum(["visible", "hidden"]),
          userLevel: levels,
          version: z.number().int().min(0),
        })
        .refine((b) => b.teamId === undefined || b.teamId === teamId, {
          message: "Body teamId must equal the path teamId",
        }),
    );
    const result = await putTeamVisibility(
      {
        teamId,
        teamLevel: body.teamLevel,
        userLevel: body.userLevel,
        version: body.version === 0 ? null : body.version,
      },
      auditContext(session),
    );
    if (!result.ok) {
      // A version for a setting that is not stored is a version conflict.
      return accessErrorResponse(
        result.code === "NOT_FOUND" ? "CONFLICT" : result.code,
      );
    }
    return jsonData(TeamVisibilitySchema.parse(result.value));
  },
);

export const GET = (request: Request, ctx: TeamContext) =>
  getHandler(request, ctx);
export const PUT = (request: Request, ctx: TeamContext) =>
  putHandler(request, ctx);
