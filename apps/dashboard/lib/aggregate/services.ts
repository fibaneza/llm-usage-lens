import type {
  DatedDailyRollup,
  ServiceListRow,
  ServiceRow,
} from "@llm-usage-lens/shared";

import { mergeAttribution } from "./attribution";
import { groupBy } from "./common";

// Name-merged rows for one team's detail page.
export function aggregateServiceRows(
  rollups: readonly DatedDailyRollup[],
): ServiceRow[] {
  return [...mergeAttribution(rollups, "byService").entries()]
    .map(([serviceName, row]) => ({ serviceName, ...row }))
    .sort((a, b) => b.cost - a.cost);
}

// One row per (team, service) (Data Model -- ServicesResponseSchema). Rollups
// arrive in ascending day order; a team's latest carries its current names.
export function aggregateServices(
  rollups: readonly DatedDailyRollup[],
): ServiceListRow[] {
  return [...groupBy(rollups, (r) => r.teamId).entries()]
    .flatMap(([teamId, list]) => {
      const latest = list[list.length - 1];
      return aggregateServiceRows(list).map((row) => ({
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
        a.serviceName.localeCompare(b.serviceName) ||
        a.teamId.localeCompare(b.teamId),
    );
}
