import "server-only";

import { unstable_cache } from "next/cache";

import type { AccountMeta, AppTeam } from "@llm-usage-lens/shared";

import { listAppTeams } from "@/lib/data/access/app-teams";

import { getAllAccountsCached } from "./cached-reads";

// Source: docs/specs/2026-11-10-access-control.md — "Created app teams". The
// one merge of registry teams and created teams; organisation data, not
// authorization data (Rule 60.10), so it may be cached.
export type TeamDirectoryEntry = {
  teamId: string;
  teamName: string;
  departmentId: string;
  departmentName: string;
  hasAwsAccount: boolean;
};

export const APP_TEAMS_TAG = "app-teams";

export const getAppTeamsCached = unstable_cache(
  listAppTeams,
  ["app-teams-all"],
  { revalidate: 3600, tags: [APP_TEAMS_TAG] },
);

export function buildTeamDirectory(
  accounts: AccountMeta[],
  appTeams: AppTeam[],
): TeamDirectoryEntry[] {
  const entries = new Map<string, TeamDirectoryEntry>();
  for (const a of accounts) {
    if (entries.has(a.teamId)) continue;
    entries.set(a.teamId, {
      teamId: a.teamId,
      teamName: a.teamName,
      departmentId: a.departmentId,
      departmentName: a.departmentName,
      hasAwsAccount: true,
    });
  }
  for (const t of appTeams) {
    if (entries.has(t.teamId)) continue;
    entries.set(t.teamId, {
      teamId: t.teamId,
      teamName: t.name,
      departmentId: t.departmentId,
      departmentName: t.departmentName,
      hasAwsAccount: false,
    });
  }
  return [...entries.values()];
}

export async function listTeamDirectory(): Promise<TeamDirectoryEntry[]> {
  const [accounts, appTeams] = await Promise.all([
    getAllAccountsCached(),
    getAppTeamsCached(),
  ]);
  return buildTeamDirectory(accounts, appTeams);
}

export async function findTeamEntry(
  teamId: string,
): Promise<TeamDirectoryEntry | null> {
  const directory = await listTeamDirectory();
  return directory.find((e) => e.teamId === teamId) ?? null;
}
