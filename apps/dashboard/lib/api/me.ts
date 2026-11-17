import "server-only";

import {
  MODEL_KEYS,
  canonicalUsageIdentity,
  canonicaliseByUser,
} from "@llm-usage-lens/shared";
import type {
  DatedDailyRollup,
  MeUsageResponseSchema,
  ModelKey,
} from "@llm-usage-lens/shared";
import type { z } from "zod";

import type { Scope } from "@/lib/auth/policy";

// Source: docs/specs/2026-11-10-access-control.md - "Canonical usage
// identity". The response schemas live in packages/shared (client-safe). Own usage is matched by canonical key only; usage alone never
// grants anything (T6).

type Totals = {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  invocations: number;
};

const zero = (): Totals => ({
  cost: 0,
  inputTokens: 0,
  outputTokens: 0,
  invocations: 0,
});

function add(into: Totals, entry: Totals): void {
  into.cost += entry.cost;
  into.inputTokens += entry.inputTokens;
  into.outputTokens += entry.outputTokens;
  into.invocations += entry.invocations;
}

export function ownUsageKeys(
  scope: Scope,
  email: string | null | undefined,
): Set<string> {
  const keys = new Set(scope.usageKeys);
  if (email) keys.add(canonicalUsageIdentity(email).key);
  return keys;
}

export function aggregateOwnUsage(
  rollups: readonly DatedDailyRollup[],
  keys: ReadonlySet<string>,
): z.infer<typeof MeUsageResponseSchema> {
  const byDate = new Map<string, Totals>();
  const byModel = new Map<ModelKey, Totals>();
  for (const rollup of rollups) {
    for (const modelKey of MODEL_KEYS) {
      const model = rollup.models[modelKey];
      if (!model) continue;
      for (const [key, entry] of Object.entries(
        canonicaliseByUser(model.byUser),
      )) {
        if (!keys.has(key)) continue;
        const day = byDate.get(rollup.date) ?? zero();
        add(day, entry);
        byDate.set(rollup.date, day);
        const total = byModel.get(modelKey) ?? zero();
        add(total, entry);
        byModel.set(modelKey, total);
      }
    }
  }
  const daily = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({ date, ...day }));
  const totals = zero();
  for (const day of daily) add(totals, day);
  return {
    totals,
    daily,
    byModel: [...byModel.entries()].map(([model, total]) => ({
      model,
      ...total,
    })),
  };
}
