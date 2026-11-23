import "server-only";

import { listTeamDirectory } from "@/lib/api/team-directory";
import { listAllTeamMemberOids } from "@/lib/data/access/team-member-lookup";
import { listTeamLinks } from "@/lib/data/litellm/team-links";

// Source: Design System - Management pages, "List, then the team" (unit TM1;
// D-TM1): one row per registry and created team. The caller passes the scope
// rule; members are counted only for the teams it allows. Member and link
// counts are read per request, never cached (Rule 60.10; they sit beside
// authorization data).
export type TeamListRow = {
  teamId: string;
  teamName: string;
  departmentId: string;
  departmentName: string;
  memberCount: number;
  litellmTeamId: string | null;
  litellmLinked: boolean;
};

export type TeamListSourceRow = Omit<TeamListRow, "litellmLinked">;

export async function listTeamRows(
  allowed: (team: { teamId: string; departmentId: string }) => boolean,
): Promise<TeamListSourceRow[]> {
  const [directory, links] = await Promise.all([
    listTeamDirectory(),
    listTeamLinks(),
  ]);
  const linkByTeam = new Map(links.map((l) => [l.teamId, l.litellmTeamId]));
  const rows = await Promise.all(
    directory.filter(allowed).map(async (entry) => ({
      teamId: entry.teamId,
      teamName: entry.teamName,
      departmentId: entry.departmentId,
      departmentName: entry.departmentName,
      memberCount: (await listAllTeamMemberOids(entry.teamId)).length,
      litellmTeamId: linkByTeam.get(entry.teamId) ?? null,
    })),
  );
  return rows.sort((a, b) => a.teamName.localeCompare(b.teamName));
}
