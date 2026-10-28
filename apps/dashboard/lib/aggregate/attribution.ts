import type {
  AttributionEntry,
  AttributionRow,
  DatedDailyRollup,
} from "@bedrock-usage/shared";

// Per-user / per-service views use per-model attribution only (Rule 20.3,
// 20.12): cost is a proportional estimate and non-model cost never appears.

export function mergeAttribution(
  rollups: readonly DatedDailyRollup[],
  field: "byUser" | "byService",
  model?: string,
): Map<string, AttributionRow> {
  const merged = new Map<string, AttributionRow>();
  for (const rollup of rollups) {
    for (const [modelKey, usage] of Object.entries(rollup.models)) {
      if (model && modelKey !== model) continue;
      const entries: Record<string, AttributionEntry> = usage[field] ?? {};
      for (const [name, entry] of Object.entries(entries)) {
        const row = merged.get(name) ?? {
          cost: 0,
          costEstimated: true as const,
          inputTokens: 0,
          outputTokens: 0,
          invocations: 0,
        };
        row.cost += entry.cost;
        row.inputTokens += entry.inputTokens;
        row.outputTokens += entry.outputTokens;
        row.invocations += entry.invocations;
        merged.set(name, row);
      }
    }
  }
  return merged;
}
