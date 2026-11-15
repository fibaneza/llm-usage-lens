import "server-only";

import { getAllAccountsCached } from "@/lib/api/cached-reads";
import type { TeamRef } from "@/lib/auth/write-policy";

// Source: docs/specs/2026-11-10-access-control.md - "Hierarchy" (teams and
// departments exist through AccountMeta). Account metadata, not authorization
// data, so the hourly account cache is fine (Rule 60.10).
export async function findTeam(teamId: string): Promise<TeamRef | null> {
  const account = (await getAllAccountsCached()).find(
    (a) => a.teamId === teamId,
  );
  return account ? { teamId, departmentId: account.departmentId } : null;
}

export async function findDepartment(
  departmentId: string,
): Promise<string | null> {
  const found = (await getAllAccountsCached()).some(
    (a) => a.departmentId === departmentId,
  );
  return found ? departmentId : null;
}
