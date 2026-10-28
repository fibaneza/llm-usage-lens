import type {
  DatedDailyRollup,
  NonModelCategory,
  NonModelCategoryTotal,
} from "@bedrock-usage/shared";

// Source: docs/specs/2026-05-15-data-model.md — "Non-Model Charges / Dashboard
// impact (v1)"; Rule 20.12. Non-model cost is account-level only: it is summed
// here and never folded into a model, user, or service.

export type CostSplit = {
  modelCost: number;
  nonModelCost: number;
  nonModelByCategory: NonModelCategoryTotal[];
};

export function modelCostOf(rollup: DatedDailyRollup): number {
  let sum = 0;
  for (const usage of Object.values(rollup.models)) sum += usage.cost;
  return sum;
}

export function nonModelCostOf(rollup: DatedDailyRollup): number {
  let sum = 0;
  for (const charge of Object.values(rollup.nonModel ?? {})) {
    sum += charge.cost;
  }
  return sum;
}

export function splitCosts(rollups: readonly DatedDailyRollup[]): CostSplit {
  let modelCost = 0;
  let nonModelCost = 0;
  const categories = new Map<NonModelCategory, NonModelCategoryTotal>();
  for (const rollup of rollups) {
    modelCost += modelCostOf(rollup);
    for (const [category, charge] of Object.entries(rollup.nonModel ?? {}) as [
      NonModelCategory,
      NonNullable<DatedDailyRollup["nonModel"]>[NonModelCategory] & object,
    ][]) {
      nonModelCost += charge.cost;
      const existing = categories.get(category);
      if (existing) {
        existing.cost += charge.cost;
        existing.recurring = existing.recurring || charge.recurring;
      } else {
        categories.set(category, {
          category,
          cost: charge.cost,
          recurring: charge.recurring,
        });
      }
    }
  }
  return {
    modelCost,
    nonModelCost,
    nonModelByCategory: [...categories.values()],
  };
}
