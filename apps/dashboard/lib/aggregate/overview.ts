import type {
  DatedDailyRollup,
  ModelKey,
  OverviewResponse,
} from "@bedrock-usage/shared";

import { dailyTrend, groupBy, modelBreakdown, totalsOf } from "./common";
import { splitCosts } from "./non-model";

export const DEFAULT_TOP_N = 5;

export function aggregateOverview(
  rollups: readonly DatedDailyRollup[],
  options: { topN?: number } = {},
): OverviewResponse {
  const { cost: totalCost, ...totals } = totalsOf(rollups);
  const byDept = groupBy(rollups, (r) => r.departmentId);
  const topDepartments = [...byDept.entries()]
    .map(([departmentId, list]) => ({
      departmentId,
      departmentName: list[0]?.departmentName ?? departmentId,
      cost: totalsOf(list).cost,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, options.topN ?? DEFAULT_TOP_N);
  const byModel = modelBreakdown(rollups);
  let mostUsedModel: ModelKey | null = null;
  let mostInvocations = 0;
  for (const m of byModel) {
    if (m.invocations > mostInvocations) {
      mostInvocations = m.invocations;
      mostUsedModel = m.model;
    }
  }
  return {
    ...totals,
    totalCost,
    costFinalized: rollups.every((r) => r.costFinalized),
    activeAccounts: new Set(rollups.map((r) => r.accountId)).size,
    mostUsedModel,
    byModel,
    nonModelByCategory: splitCosts(rollups).nonModelByCategory,
    dailyTrend: dailyTrend(rollups),
    topDepartments,
  };
}
