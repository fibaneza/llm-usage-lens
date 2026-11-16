import "server-only";

import {
  canonicalUsageIdentity,
  canonicaliseByUser,
} from "@llm-usage-lens/shared";
import type {
  DatedDailyRollup,
  MeUsageResponseSchema,
} from "@llm-usage-lens/shared";
import type { z } from "zod";

import type { Scope } from "@/lib/auth/policy";

// Source: docs/specs/2026-11-10-access-control.md - "Canonical usage
// identity". The response schemas live in packages/shared (client-safe). Own usage is matched by canonical key only; usage alone never
// grants anything (T6).

const ZERO = { cost: 0, inputTokens: 0, outputTokens: 0, invocations: 0 };

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
  const byDate = new Map<string, typeof ZERO>();
  for (const rollup of rollups) {
    for (const model of Object.values(rollup.models)) {
      for (const [key, entry] of Object.entries(
        canonicaliseByUser(model.byUser),
      )) {
        if (!keys.has(key)) continue;
        const day = byDate.get(rollup.date) ?? { ...ZERO };
        day.cost += entry.cost;
        day.inputTokens += entry.inputTokens;
        day.outputTokens += entry.outputTokens;
        day.invocations += entry.invocations;
        byDate.set(rollup.date, day);
      }
    }
  }
  const daily = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({ date, ...day }));
  const totals = daily.reduce(
    (sum, d) => ({
      cost: sum.cost + d.cost,
      inputTokens: sum.inputTokens + d.inputTokens,
      outputTokens: sum.outputTokens + d.outputTokens,
      invocations: sum.invocations + d.invocations,
    }),
    { ...ZERO },
  );
  return { totals, daily };
}
