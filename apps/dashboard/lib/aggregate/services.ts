import type { DatedDailyRollup, ServiceRow } from "@bedrock-usage/shared";

import { mergeAttribution } from "./attribution";

export function aggregateServices(
  rollups: readonly DatedDailyRollup[],
): ServiceRow[] {
  return [...mergeAttribution(rollups, "byService").entries()]
    .map(([serviceName, row]) => ({ serviceName, ...row }))
    .sort((a, b) => b.cost - a.cost);
}
