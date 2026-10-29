import type {
  DatedDailyRollup,
  TeamDetailResponse,
  TeamRow,
} from "@bedrock-usage/shared";

import { dailyTrend, groupBy, modelBreakdown, totalsOf } from "./common";
import { splitCosts } from "./non-model";
import { aggregateServices } from "./services";
import { aggregateUsers } from "./users";

const byCostDesc = (a: { cost: number }, b: { cost: number }) =>
  b.cost - a.cost;

export function aggregateTeams(
  rollups: readonly DatedDailyRollup[],
  options: { departmentId?: string } = {},
): TeamRow[] {
  const scoped = options.departmentId
    ? rollups.filter((r) => r.departmentId === options.departmentId)
    : rollups;
  return [...groupBy(scoped, (r) => r.teamId).entries()]
    .map(([teamId, list]) => teamRow(teamId, list))
    .sort(byCostDesc);
}

function teamRow(
  teamId: string,
  list: readonly DatedDailyRollup[],
  fallbackName = teamId,
): TeamRow {
  // Rollups arrive in ascending day order; the latest carries the current name.
  const first = list[list.length - 1];
  return {
    teamId,
    teamName: first?.teamName ?? fallbackName,
    departmentId: first?.departmentId ?? "",
    departmentName: first?.departmentName ?? "",
    ...totalsOf(list),
  };
}

export function aggregateTeamDetail(
  rollups: readonly DatedDailyRollup[],
  teamId: string,
  fallback: { teamName?: string } = {},
): TeamDetailResponse {
  const own = rollups.filter((r) => r.teamId === teamId);
  return {
    ...teamRow(teamId, own, fallback.teamName),
    nonModelByCategory: splitCosts(own).nonModelByCategory,
    accounts: [...groupBy(own, (r) => r.accountId).entries()]
      .map(([accountId, list]) => ({ accountId, ...totalsOf(list) }))
      .sort(byCostDesc),
    dailyTrend: dailyTrend(own),
    byModel: modelBreakdown(own),
    services: aggregateServices(own),
    users: aggregateUsers(own),
  };
}
