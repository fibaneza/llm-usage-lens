import { z } from "zod";

// Canonical model keys and the raw-ID mapping live here and only here
// (Rule 20.5) so apps/dashboard and apps/collector never drift.
// Source: docs/specs/2026-05-15-data-model.md — "Model ID Normalization".
export const MODEL_KEYS = [
  "claude-opus",
  "claude-sonnet",
  "claude-haiku",
  "other",
] as const;

export const ModelKeySchema = z.enum(MODEL_KEYS);

export type ModelKey = z.infer<typeof ModelKeySchema>;

export type ModelMeta = {
  displayName: string;
  // CSS custom property name; the color value itself is realized in
  // apps/dashboard/app/globals.css (Rule 40.2 — no raw hex outside tokens).
  chartToken: string;
};

export const MODEL_META: Record<ModelKey, ModelMeta> = {
  "claude-opus": {
    displayName: "Claude Opus",
    chartToken: "--color-model-opus",
  },
  "claude-sonnet": {
    displayName: "Claude Sonnet",
    chartToken: "--color-model-sonnet",
  },
  "claude-haiku": {
    displayName: "Claude Haiku",
    chartToken: "--color-model-haiku",
  },
  other: {
    displayName: "Other models",
    chartToken: "--color-model-other",
  },
};

// Family is matched by prefix: an optional generation segment (e.g. "3-5-")
// may precede the family token; version/date suffixes after it are ignored.
// Handles both old-style (claude-3-5-sonnet-…) and new-style
// (claude-sonnet-4-…) raw IDs.
const FAMILY_PATTERNS: ReadonlyArray<readonly [RegExp, ModelKey]> = [
  [/^anthropic\.claude-(?:\d+(?:-\d+)*-)?opus(?:-|$)/, "claude-opus"],
  [/^anthropic\.claude-(?:\d+(?:-\d+)*-)?sonnet(?:-|$)/, "claude-sonnet"],
  [/^anthropic\.claude-(?:\d+(?:-\d+)*-)?haiku(?:-|$)/, "claude-haiku"],
];

export function normalizeModelId(rawId: string): ModelKey {
  // Region-prefixed inference-profile IDs (us. / eu. / apac. / …) strip the
  // region segment before matching.
  const withoutRegion = rawId.replace(/^[a-z0-9-]+\.(?=anthropic\.)/, "");
  // ":N" inference-profile suffix never affects the family.
  const candidate = withoutRegion.replace(/:\d+$/, "");

  for (const [pattern, key] of FAMILY_PATTERNS) {
    if (pattern.test(candidate)) return key;
  }
  return "other";
}
