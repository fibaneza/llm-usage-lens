import type {
  DatedDailyRollup,
  UserListRow,
  UserRow,
} from "@llm-usage-lens/shared";

import { mergeAttribution } from "./attribution";
import { groupBy } from "./common";

// Name-merged rows for one team's or department's detail page.
export function aggregateUserRows(
  rollups: readonly DatedDailyRollup[],
): UserRow[] {
  return [...mergeAttribution(rollups, "byUser").entries()]
    .map(([userId, row]) => ({ userId, ...row }))
    .sort((a, b) => b.cost - a.cost);
}

// One row per (team, user) (Data Model -- UsersResponseSchema). Rollups arrive
// in ascending day order; a team's latest carries its current names.
export function aggregateUsers(
  rollups: readonly DatedDailyRollup[],
): UserListRow[] {
  return [...groupBy(rollups, (r) => r.teamId).entries()]
    .flatMap(([teamId, list]) => {
      const latest = list[list.length - 1];
      return aggregateUserRows(list).map((row) => ({
        ...row,
        teamId,
        teamName: latest?.teamName ?? teamId,
        departmentId: latest?.departmentId ?? "",
        departmentName: latest?.departmentName ?? "",
      }));
    })
    .sort(
      (a, b) =>
        b.cost - a.cost ||
        a.userId.localeCompare(b.userId) ||
        a.teamId.localeCompare(b.teamId),
    );
}
