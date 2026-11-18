import {
  CreateAppTeamInputSchema,
  TeamsQuerySchema,
  TeamsResponseSchema,
  appTeamNameKey,
} from "@llm-usage-lens/shared";
import { revalidateTag } from "next/cache";

import { aggregateTeams } from "@/lib/aggregate/teams";
import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { getAllAccountsCached } from "@/lib/api/cached-reads";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { loadManager } from "@/lib/api/matrix-route";
import {
  jsonData,
  jsonError,
  parseJsonBody,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { scopeFor, teamRollups } from "@/lib/api/scoped-rollups";
import { APP_TEAMS_TAG } from "@/lib/api/team-directory";
import { isMatrixWriter } from "@/lib/auth/write-policy";
import { createAppTeam } from "@/lib/data/access/app-teams";

export const revalidate = 3600;

export const GET = withRoute(async (request, _ctx, session) => {
  const { dateFrom, dateTo, departmentId } = parseSearchParams(
    request,
    TeamsQuerySchema,
  );
  const rollups = await loadRangeRollups(dateFrom, dateTo);
  const scope = await scopeFor(session, rollups);
  return jsonData(
    TeamsResponseSchema.parse({
      teams: aggregateTeams(teamRollups(scope, rollups), { departmentId }),
    }),
  );
});

// Source: docs/specs/2026-11-10-access-control.md - "Created app teams":
// internal-admin and internal-org-admin create a team with no AWS account;
// the id is generated server-side (T-MI3). 403 and its denied record come
// before parsing.
export const POST = withRoute(
  async (request, _ctx, session) => {
    const input = await parseJsonBody(request, CreateAppTeamInputSchema);
    const accounts = await getAllAccountsCached();
    const department = accounts.find(
      (a) => a.departmentId === input.departmentId,
    );
    if (!department) return jsonError(400, "BAD_REQUEST", "Unknown department");
    // Accepted race: the cached registry can lag a concurrent account write,
    // so a duplicate name may slip through for up to the cache window.
    const key = appTeamNameKey(input.name);
    if (accounts.some((a) => appTeamNameKey(a.teamName) === key)) {
      return jsonError(409, "CONFLICT", "A team with this name already exists");
    }
    const result = await createAppTeam(
      {
        name: input.name,
        departmentId: input.departmentId,
        departmentName: department.departmentName,
      },
      auditContext(session),
    );
    if (!result.ok) return accessErrorResponse(result.code);
    revalidateTag(APP_TEAMS_TAG, { expire: 0 });
    return jsonData(result.value, { status: 201 });
  },
  {
    permit: async (_request, session) => {
      const actor = await loadManager(session);
      return actor !== null && isMatrixWriter(actor.roles);
    },
    denied: { action: "appteam.create", pattern: "/api/teams" },
  },
);
