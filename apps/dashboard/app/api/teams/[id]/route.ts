import {
  DateRangeQuerySchema,
  TeamDetailResponseSchema,
  UpdateAppTeamInputSchema,
  appTeamNameKey,
  isReservedTeamId,
} from "@llm-usage-lens/shared";
import { revalidateTag } from "next/cache";

import { aggregateTeamDetail } from "@/lib/aggregate/teams";
import { aggregateUserRows } from "@/lib/aggregate/users";
import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { getAllAccountsCached } from "@/lib/api/cached-reads";
import { IdParamSchema } from "@/lib/api/id-param";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { loadManager } from "@/lib/api/matrix-route";
import {
  NOT_FOUND_MESSAGE,
  NotFoundError,
  jsonData,
  jsonError,
  parseInput,
  parseJsonBody,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { redactUsers, scopeFor, teamRollups } from "@/lib/api/scoped-rollups";
import { APP_TEAMS_TAG } from "@/lib/api/team-directory";
import { can } from "@/lib/auth/policy";
import { isMatrixWriter } from "@/lib/auth/write-policy";
import {
  getAppTeam,
  hasAppTeamName,
  updateAppTeam,
} from "@/lib/data/access/app-teams";

export const revalidate = 3600;

export const GET = withRoute(async (request, { params }, session) => {
  const id = parseInput((await params).id, IdParamSchema);
  const { dateFrom, dateTo, accountId } = parseSearchParams(
    request,
    DateRangeQuerySchema,
  );
  const meta = (await getAllAccountsCached()).find((a) => a.teamId === id);
  const rollups = await loadRangeRollups(dateFrom, dateTo, accountId);
  // A team that left AccountMeta but has rollups in range is historical.
  const historical = [...rollups].reverse().find((r) => r.teamId === id);
  const teamName = meta?.teamName ?? historical?.teamName;
  const scope = await scopeFor(session, rollups, { teamIds: [id] });
  const visible = teamRollups(scope, rollups);
  const readable =
    visible.some((r) => r.teamId === id) ||
    can(scope, "read", {
      kind: "team",
      teamId: id,
      departmentId: meta?.departmentId ?? historical?.departmentId ?? "",
      date: dateTo,
    });
  if (teamName === undefined || !readable) {
    throw new NotFoundError(NOT_FOUND_MESSAGE);
  }
  const detail = aggregateTeamDetail(visible, id, { teamName });
  return jsonData(
    TeamDetailResponseSchema.parse({
      ...detail,
      users: aggregateUserRows(
        redactUsers(
          scope,
          visible.filter((r) => r.teamId === id),
        ),
      ),
      departmentId: detail.departmentId || meta?.departmentId,
      departmentName: detail.departmentName || meta?.departmentName,
    }),
  );
});

// Source: docs/specs/2026-11-10-access-control.md - "Edit a created team"
// (unit TP1, Q-R3-2): internal-admin and internal-org-admin rename and move a
// created team; 403 and its denied record come before parsing.
export const PATCH = withRoute(
  async (request, { params }, session) => {
    const id = parseInput((await params).id, IdParamSchema);
    const input = await parseJsonBody(request, UpdateAppTeamInputSchema);
    const accounts = await getAllAccountsCached();
    if (!isReservedTeamId(id) && accounts.some((a) => a.teamId === id)) {
      return jsonError(400, "BAD_REQUEST", "Edited in Settings → AWS accounts");
    }
    const department = accounts.find(
      (a) => a.departmentId === input.departmentId,
    );
    if (!department) return jsonError(400, "BAD_REQUEST", "Unknown department");
    const key = appTeamNameKey(input.name);
    if (accounts.some((a) => appTeamNameKey(a.teamName) === key)) {
      return jsonError(409, "CONFLICT", "A team with this name already exists");
    }
    const current = await getAppTeam(id);
    if (
      current &&
      appTeamNameKey(current.name) !== key &&
      (await hasAppTeamName(input.name))
    ) {
      return jsonError(409, "CONFLICT", "A team with this name already exists");
    }
    const result = await updateAppTeam(
      id,
      {
        name: input.name,
        departmentId: input.departmentId,
        departmentName: department.departmentName,
        version: input.version,
      },
      auditContext(session),
    );
    if (!result.ok) return accessErrorResponse(result.code);
    revalidateTag(APP_TEAMS_TAG, { expire: 0 });
    return jsonData(result.value);
  },
  {
    permit: async (_request, session) => {
      const actor = await loadManager(session);
      return actor !== null && isMatrixWriter(actor.roles);
    },
    denied: { action: "appteam.update", pattern: "/api/teams/[id]" },
  },
);
