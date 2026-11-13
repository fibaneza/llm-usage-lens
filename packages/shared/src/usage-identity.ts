import { z } from "zod";

import type { AttributionEntry } from "./schemas/daily-rollup";

// Access Control spec — "Canonical usage identity"; Rule 20.14.
export type CanonicalUsageIdentity =
  | { kind: "person"; key: string }
  | { kind: "non-person"; key: string };

const EmailSchema = z.email();

export function canonicalUsageIdentity(raw: string): CanonicalUsageIdentity {
  const tail = raw.trim().split(/[/:]/).pop() ?? "";
  const candidate = tail.trim().toLowerCase();
  if (EmailSchema.safeParse(candidate).success) {
    return { kind: "person", key: candidate };
  }
  return { kind: "non-person", key: raw };
}

export function canonicaliseByUser(
  byUser: Record<string, AttributionEntry>,
): Record<string, AttributionEntry> {
  const out: Record<string, AttributionEntry> = {};
  for (const [raw, entry] of Object.entries(byUser)) {
    const { key } = canonicalUsageIdentity(raw);
    const existing = out[key];
    out[key] = existing
      ? {
          ...existing,
          cost: existing.cost + entry.cost,
          inputTokens: existing.inputTokens + entry.inputTokens,
          outputTokens: existing.outputTokens + entry.outputTokens,
          invocations: existing.invocations + entry.invocations,
          costEstimated: existing.costEstimated || entry.costEstimated,
        }
      : entry;
  }
  return out;
}
