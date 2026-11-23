import "server-only";

import { findTeamEntry } from "@/lib/api/team-directory";
import type { TeamDirectoryEntry } from "@/lib/api/team-directory";
import type { resolveScope } from "@/lib/auth/policy";

// Source: Access Control - Enforcement item 2 (TM1 sentence) and Design System
// - "List, then the team": one in-scope rule for the Team list, the ?team=
// redirect and the team page. A global reader sees every team; a lead sees the
// teams of its team scopes and of its department scopes.
type TeamScopes = Pick<
  ReturnType<typeof resolveScope>,
  "teamScopes" | "departmentScopes"
>;

export const teamInScope = (
  scope: TeamScopes,
  global: boolean,
  team: { teamId: string; departmentId: string },
): boolean =>
  global ||
  scope.teamScopes.has(team.teamId) ||
  scope.departmentScopes.has(team.departmentId);

// Null for an unknown team and for one outside the scope: the same 404.
export async function findTeamInScope(
  teamId: string,
  global: boolean,
  scope: TeamScopes,
): Promise<TeamDirectoryEntry | null> {
  const entry = await findTeamEntry(teamId);
  return entry && teamInScope(scope, global, entry) ? entry : null;
}
