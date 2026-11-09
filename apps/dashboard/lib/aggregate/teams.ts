import type {
  DatedDailyRollup,
  TeamDetailResponse,
  TeamRow,
} from "@llm-usage-lens/shared";

import { dailyTrend, groupBy, modelBreakdown, totalsOf } from "./common";
import { splitCosts } from "./non-model";
import { aggregateServiceRows } from "./services";
import { aggregateUserRows } from "./users";

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

// `_untagged` is the absence of a service tag, not a service (Rule 20.10).
function attributionCounts(list: readonly DatedDailyRollup[]) {
  const services = new Set<string>();
  const users = new Set<string>();
  for (const r of list) {
    for (const entry of Object.values(r.models)) {
      for (const service of Object.keys(entry.byService)) {
        if (service !== "_untagged") services.add(service);
      }
      for (const user of Object.keys(entry.byUser)) users.add(user);
    }
  }
  return { serviceCount: services.size, userCount: users.size };
}

function teamRow(
  teamId: string,
  list: readonly DatedDailyRollup[],
  fallbackName = teamId,
): TeamRow {
  // Rollups arrive in ascending day order; the latest carries the current name.
  const latest = list[list.length - 1];
  return {
    teamId,
    teamName: latest?.teamName ?? fallbackName,
    departmentId: latest?.departmentId ?? "",
    departmentName: latest?.departmentName ?? "",
    ...totalsOf(list),
    ...attributionCounts(list),
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
    services: aggregateServiceRows(own),
    users: aggregateUserRows(own),
  };
}
