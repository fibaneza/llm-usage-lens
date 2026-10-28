import { MODEL_KEYS } from "./models";
import type { ModelKey } from "./models";
import type { NonModelCategory } from "./schemas/non-model-charge";

// Every marker below is illustrative and unverified until Phase 6 confirms
// real GetCostAndUsage USAGE_TYPE strings.
// Source: docs/specs/2026-05-15-system-architecture.md — "Cost Explorer
// USAGE_TYPE classification" (ordered table, first match wins).
export type UsageTypeClassification =
  | { kind: "model"; key: ModelKey }
  | { kind: "nonModel"; category: Exclude<NonModelCategory, "unclassified"> }
  | { kind: "unclassified" };

// Linear-time equivalent of /custommodel.*storage/ (no backtracking).
const CUSTOM_MODEL_STORAGE = {
  test(text: string): boolean {
    const i = text.indexOf("custommodel");
    return i >= 0 && text.indexOf("storage", i) >= 0;
  },
};

type NonModelRow = readonly [
  { test(text: string): boolean },
  Exclude<NonModelCategory, "unclassified">,
];

const REGION_PREFIX = /^[A-Z]{2,4}[0-9]+-/;

// Rows 1-11, matched against the lower-cased remainder.
const NON_MODEL_ROWS: readonly NonModelRow[] = [
  [
    /guardrail|contentfilter|deniedtopic|sensitiveinformation|contextualgrounding|automatedreasoning/,
    "guardrails",
  ],
  [/custommodelunit|modelimport/, "custom-model-import"],
  [CUSTOM_MODEL_STORAGE, "custom-model-storage"],
  [/provisionedthroughput|modelunit/, "provisioned-throughput"],
  [/customization|finetuning|training/, "model-customization"],
  [/knowledgebase|retrieve|rerank/, "knowledge-bases"],
  [/agent/, "agents"],
  [/flow|nodetransition/, "flows"],
  [/dataautomation|(?:^|[-_:])bda(?:$|[-_:])/, "data-automation"],
  [/evaluation|humantask/, "model-evaluation"],
  [/promptrouting|promptoptimization|websearch/, "other-features"],
];

// Row 12 matchers come from MODEL_KEYS (e.g. "claude-opus"): the key's
// segments joined by an optional separator and optional generation/version
// digits, so ClaudeSonnet, Claude3-5-Sonnet and claude-sonnet all match.
const FAMILY_ROWS: ReadonlyArray<readonly [RegExp, ModelKey]> =
  MODEL_KEYS.filter((key) => key !== "other").map((key) => [
    new RegExp(key.split("-").join("[-_]?(?:\\d+(?:[-_.]\\d+)*[-_]?)?")),
    key,
  ]);

const TOKEN_MARKER = /input-?tokens?|output-?tokens?/;

export function classifyUsageType(raw: string): UsageTypeClassification {
  const text = raw.replace(REGION_PREFIX, "").toLowerCase();

  for (const [pattern, category] of NON_MODEL_ROWS) {
    if (pattern.test(text)) return { kind: "nonModel", category };
  }
  for (const [pattern, key] of FAMILY_ROWS) {
    if (pattern.test(text)) return { kind: "model", key };
  }
  if (TOKEN_MARKER.test(text)) return { kind: "model", key: "other" };
  return { kind: "unclassified" };
}
