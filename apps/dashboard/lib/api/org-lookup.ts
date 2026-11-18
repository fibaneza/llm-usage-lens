import "server-only";

import { getAllAccountsCached } from "@/lib/api/cached-reads";
import { findTeamEntry } from "@/lib/api/team-directory";
import type { TeamRef } from "@/lib/auth/write-policy";

// Source: docs/specs/2026-11-10-access-control.md - "Hierarchy" (teams exist
// through AccountMeta or as created app teams; departments through AccountMeta). Account metadata, not authorization
// data, so the hourly account cache is fine (Rule 60.10).
export async function findTeam(teamId: string): Promise<TeamRef | null> {
  const entry = await findTeamEntry(teamId);
  return entry ? { teamId, departmentId: entry.departmentId } : null;
}

export async function findDepartment(
  departmentId: string,
): Promise<string | null> {
  const found = (await getAllAccountsCached()).some(
    (a) => a.departmentId === departmentId,
  );
  return found ? departmentId : null;
}
