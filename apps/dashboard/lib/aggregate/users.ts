import type { DatedDailyRollup, UserRow } from "@bedrock-usage/shared";

import { mergeAttribution } from "./attribution";

export function aggregateUsers(
  rollups: readonly DatedDailyRollup[],
): UserRow[] {
  return [...mergeAttribution(rollups, "byUser").entries()]
    .map(([userId, row]) => ({ userId, ...row }))
    .sort((a, b) => b.cost - a.cost);
}
