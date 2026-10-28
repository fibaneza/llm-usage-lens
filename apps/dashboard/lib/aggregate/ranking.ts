import type {
  DatedDailyRollup,
  ModelKey,
  RankingQuery,
  RankingRow,
} from "@bedrock-usage/shared";

import { mergeAttribution } from "./attribution";
import { groupBy } from "./common";

export type RankingSortField = NonNullable<RankingQuery["sortBy"]>;

export type RankingOptions = {
  tab: RankingQuery["tab"];
  model?: ModelKey;
  sortBy?: RankingSortField;
  order: "asc" | "desc";
  limit: number;
};

function entityRow(
  id: string,
  name: string,
  list: readonly DatedDailyRollup[],
  model: ModelKey | undefined,
): RankingRow {
  const row: RankingRow = {
    id,
    name,
    cost: 0,
    costEstimated: false,
    inputTokens: 0,
    outputTokens: 0,
    invocations: 0,
  };
  for (const r of list) {
    if (model) {
      const usage = r.models[model];
      if (!usage) continue;
      row.cost += usage.cost;
      row.inputTokens += usage.inputTokens;
      row.outputTokens += usage.outputTokens;
      row.invocations += usage.invocations;
    } else {
      row.cost += r.cost;
      row.inputTokens += r.inputTokens;
      row.outputTokens += r.outputTokens;
      row.invocations += r.invocations;
    }
  }
  return row;
}

function candidates(
  rollups: readonly DatedDailyRollup[],
  { tab, model }: RankingOptions,
): RankingRow[] {
  if (tab === "departments" || tab === "teams") {
    const idOf = (r: DatedDailyRollup) =>
      tab === "departments" ? r.departmentId : r.teamId;
    const nameOf = (r: DatedDailyRollup) =>
      tab === "departments" ? r.departmentName : r.teamName;
    return [...groupBy(rollups, idOf).entries()]
      .filter(([, list]) => !model || list.some((r) => r.models[model]))
      .map(([id, list]) =>
        entityRow(id, list[0] ? nameOf(list[0]) : id, list, model),
      );
  }
  const field = tab === "users" ? "byUser" : "byService";
  return [...mergeAttribution(rollups, field, model).entries()].map(
    ([id, row]) => ({ id, name: id, ...row }),
  );
}

export function rankEntities(
  rollups: readonly DatedDailyRollup[],
  options: RankingOptions,
): RankingRow[] {
  const sortBy = options.sortBy ?? "cost";
  const direction = options.order === "asc" ? 1 : -1;
  return candidates(rollups, options)
    .sort((a, b) => direction * (a[sortBy] - b[sortBy]))
    .slice(0, options.limit);
}
