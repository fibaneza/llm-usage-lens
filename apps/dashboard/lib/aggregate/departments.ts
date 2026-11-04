import type {
  DatedDailyRollup,
  DepartmentDetailResponse,
  DepartmentRow,
} from "@bedrock-usage/shared";

import {
  dailyTrend,
  groupBy,
  modelBreakdown,
  mostUsedModelOf,
  totalsOf,
} from "./common";
import { aggregateUsers } from "./users";
import { splitCosts } from "./non-model";
import { aggregateTeams } from "./teams";

export function aggregateDepartments(
  rollups: readonly DatedDailyRollup[],
): DepartmentRow[] {
  return [...groupBy(rollups, (r) => r.departmentId).entries()]
    .map(([departmentId, list]) => ({
      departmentId,
      departmentName: list[list.length - 1]?.departmentName ?? departmentId,
      ...totalsOf(list),
      ...teamsAndTopModel(list),
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
    departmentName: own[own.length - 1]?.departmentName ?? fallbackName,
    ...totalsOf(own),
    ...teamsAndTopModel(own),
    nonModelByCategory: splitCosts(own).nonModelByCategory,
    teams: aggregateTeams(own),
    dailyTrend: dailyTrend(own),
    topUsers: aggregateUsers(own).slice(0, TOP_USERS_LIMIT),
    teamTrend: teamTrend(own),
  };
}

const TOP_USERS_LIMIT = 10;

// A team that moved departments counts under each department its rollups name
// (Data Model spec -- Historical Snapshots).
function teamsAndTopModel(
  rollups: readonly DatedDailyRollup[],
): Pick<DepartmentRow, "teamCount" | "topModel"> {
  return {
    teamCount: new Set(rollups.map((r) => r.teamId)).size,
    topModel: mostUsedModelOf(modelBreakdown(rollups)),
  };
}

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
