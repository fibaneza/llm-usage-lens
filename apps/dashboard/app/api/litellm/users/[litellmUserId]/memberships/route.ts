import { LiteLLMUserMembershipsResponseSchema } from "@llm-usage-lens/shared";

import { loadManager } from "@/lib/api/matrix-route";
import {
  NOT_FOUND_MESSAGE,
  NotFoundError,
  jsonData,
  parseInput,
  withRoute,
} from "@/lib/api/respond";
import {
  decideWrite,
  isMatrixWriter,
  mayAttempt,
} from "@/lib/auth/write-policy";
import { buildTeamDirectory } from "@/lib/api/team-directory";
import { getAllAccounts } from "@/lib/data/account-meta";
import { listAppTeams } from "@/lib/data/access/app-teams";
import { listTeamLinks } from "@/lib/data/litellm/team-links";
import { LiteLLMError, isLiteLLMConfigured } from "@/lib/litellm/client";
import { getTeam, getUser } from "@/lib/litellm/operations";
import {
  LiteLLMUserIdSchema,
  enabledOperations,
  liteLLMResponse,
  reduceMembers,
  requireEnabled,
  teamAccess,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";
import { runBoundedSettled } from "@/lib/litellm/run-settled";

// Source: docs/specs/2026-11-10-litellm.md - `resetMemberSpend` row (RS1),
// "Roles and rights" (members write: Lead in scope, org-admin, Admin), "Reads"
// (getUser, getTeam), LD19 (a disabled read is 403 before any call), LD23
// (Organisation cap omits spend and budget), LD34 (one getTeam per listed
// team), LD37 (not configured is 200, no call), LT21 (out of scope is the same
// 404 as missing); Access Control - Enforcement item 2. Lists the person's
// LiteLLM teams that are linked to a dashboard team the caller may reset.

export const dynamic = "force-dynamic";

const TEAM_READ_CONCURRENCY = 5;
const notFound = () => new NotFoundError(NOT_FOUND_MESSAGE);

export const GET = withRoute(async (_request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const actor = await loadManager(session);
  if (!actor || !mayAttempt(actor, "member")) throw notFound();
  const litellmUserId = parseInput(
    (await params).litellmUserId,
    LiteLLMUserIdSchema,
  );
  return liteLLMResponse(async () => {
    const enabled = await enabledOperations();
    requireEnabled(enabled, ["getUser", "getTeam"]);
    if (!(await isLiteLLMConfigured())) {
      return jsonData(
        LiteLLMUserMembershipsResponseSchema.parse({
          configured: false,
          items: [],
        }),
      );
    }
    const [access, accounts, appTeams, links] = await Promise.all([
      teamAccess(session),
      getAllAccounts(),
      listAppTeams(),
      listTeamLinks(),
    ]);
    const info = await getUser({ litellmUserId }).catch((error: unknown) => {
      if (error instanceof LiteLLMError && error.status === 404) {
        throw notFound();
      }
      throw error;
    });
    const personTeams = new Set(
      info.teams.flatMap((t) =>
        typeof t.team_id === "string" ? [t.team_id] : [],
      ),
    );
    const linkOf = new Map(links.map((l) => [l.teamId, l.litellmTeamId]));
    const resettable: Array<{
      teamId: string;
      teamName: string;
      litellmTeamId: string;
    }> = [];
    for (const a of buildTeamDirectory(accounts, appTeams)) {
      const litellmTeamId = linkOf.get(a.teamId);
      if (!litellmTeamId || !personTeams.has(litellmTeamId)) continue;
      const verdict = decideWrite(actor, {
        operation: "member",
        team: { teamId: a.teamId, departmentId: a.departmentId },
      });
      if (verdict === "allow") {
        resettable.push({
          teamId: a.teamId,
          teamName: a.teamName,
          litellmTeamId,
        });
      }
    }
    if (resettable.length === 0 && !isMatrixWriter(actor.roles)) {
      throw notFound();
    }
    resettable.sort((a, b) => a.teamName.localeCompare(b.teamName, "en"));

    const figures = new Map<
      string,
      { spend: number; maxBudget: number | null }
    >();
    if (!access.perUserCostHidden) {
      await runBoundedSettled(
        resettable,
        TEAM_READ_CONCURRENCY,
        async (team, stopped) => {
          if (stopped()) return;
          const info$ = await getTeam({ litellmTeamId: team.litellmTeamId });
          const row = reduceMembers(info$.team_memberships, new Map()).find(
            (m) => m.userId === litellmUserId,
          );
          if (row) {
            figures.set(team.teamId, {
              spend: row.spend,
              maxBudget: row.maxBudget,
            });
          }
        },
      );
    }
    return jsonData(
      LiteLLMUserMembershipsResponseSchema.parse({
        items: resettable.map((t) => ({
          teamId: t.teamId,
          teamName: t.teamName,
          ...(figures.get(t.teamId) ?? {}),
        })),
      }),
    );
  });
});
