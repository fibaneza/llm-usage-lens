import type {
  DailyTrendPoint,
  DatedDailyRollup,
  ModelBreakdown,
  ModelKey,
  Totals,
} from "@bedrock-usage/shared";

import { modelCostOf, nonModelCostOf, splitCosts } from "./non-model";

export function totalsOf(rollups: readonly DatedDailyRollup[]): Totals {
  const { modelCost, nonModelCost } = splitCosts(rollups);
  let inputTokens = 0;
  let outputTokens = 0;
  let invocations = 0;
  for (const r of rollups) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    invocations += r.invocations;
  }
  return {
    cost: modelCost + nonModelCost,
    modelCost,
    nonModelCost,
    inputTokens,
    outputTokens,
    invocations,
  };
}

export function groupBy<K>(
  rollups: readonly DatedDailyRollup[],
  keyOf: (r: DatedDailyRollup) => K,
): Map<K, DatedDailyRollup[]> {
  const groups = new Map<K, DatedDailyRollup[]>();
  for (const r of rollups) {
    const key = keyOf(r);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return groups;
}

// UTC days sort lexicographically (YYYY-MM-DD).
export function dailyTrend(
  rollups: readonly DatedDailyRollup[],
): DailyTrendPoint[] {
  const points = new Map<string, DailyTrendPoint>();
  for (const r of rollups) {
    const modelCost = modelCostOf(r);
    const nonModelCost = nonModelCostOf(r);
    const point = points.get(r.date) ?? {
      date: r.date,
      cost: 0,
      modelCost: 0,
      nonModelCost: 0,
      byModel: {},
    };
    for (const [model, usage] of Object.entries(r.models) as [
      ModelKey,
      DatedDailyRollup["models"][ModelKey] & object,
    ][]) {
      point.byModel[model] = (point.byModel[model] ?? 0) + usage.cost;
    }
    point.modelCost += modelCost;
    point.nonModelCost += nonModelCost;
    point.cost += modelCost + nonModelCost;
    points.set(r.date, point);
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function modelBreakdown(
  rollups: readonly DatedDailyRollup[],
): ModelBreakdown[] {
  const rows = new Map<ModelKey, ModelBreakdown>();
  for (const r of rollups) {
    for (const [model, usage] of Object.entries(r.models) as [
      ModelKey,
      DatedDailyRollup["models"][ModelKey] & object,
    ][]) {
      const row = rows.get(model) ?? {
        model,
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
        invocations: 0,
      };
      row.cost += usage.cost;
      row.inputTokens += usage.inputTokens;
      row.outputTokens += usage.outputTokens;
      row.invocations += usage.invocations;
      rows.set(model, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.cost - a.cost);
}
