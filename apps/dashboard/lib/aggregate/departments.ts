import type {
  DatedDailyRollup,
  DepartmentDetailResponse,
  DepartmentRow,
} from "@bedrock-usage/shared";

import { dailyTrend, groupBy, totalsOf } from "./common";
import { aggregateUsers } from "./users";
import { splitCosts } from "./non-model";
import { aggregateTeams } from "./teams";

export function aggregateDepartments(
  rollups: readonly DatedDailyRollup[],
): DepartmentRow[] {
  return [...groupBy(rollups, (r) => r.departmentId).entries()]
    .map(([departmentId, list]) => ({
      departmentId,
      departmentName: list[0]?.departmentName ?? departmentId,
      ...totalsOf(list),
    }))
    .sort((a, b) => b.cost - a.cost);
}

export function aggregateDepartmentDetail(
  rollups: readonly DatedDailyRollup[],
  departmentId: string,
  fallbackName = departmentId,
): DepartmentDetailResponse {
  const own = rollups.filter((r) => r.departmentId === departmentId);
  return {
    departmentId,
    departmentName: own[0]?.departmentName ?? fallbackName,
    ...totalsOf(own),
    nonModelByCategory: splitCosts(own).nonModelByCategory,
    teams: aggregateTeams(own),
    dailyTrend: dailyTrend(own),
    topUsers: aggregateUsers(own).slice(0, TOP_USERS_LIMIT),
    teamTrend: teamTrend(own),
  };
}

const TOP_USERS_LIMIT = 10;

// Team cost is the rollup cost, which includes the account's non-model charges.
function teamTrend(
  rollups: readonly DatedDailyRollup[],
): DepartmentDetailResponse["teamTrend"] {
  const days = new Map<string, Map<string, number>>();
  for (const r of rollups) {
    const teams = days.get(r.date) ?? new Map<string, number>();
    teams.set(r.teamId, (teams.get(r.teamId) ?? 0) + r.cost);
    days.set(r.date, teams);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, teams]) => ({
      date,
      teams: [...teams.entries()].map(([teamId, cost]) => ({ teamId, cost })),
    }));
}
