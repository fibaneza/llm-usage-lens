import { describe, expect, it } from "vitest";

import {
  MODEL_KEYS,
  MODEL_META,
  ModelKeySchema,
  normalizeModelId,
} from "./models";

describe("ModelKeySchema", () => {
  it.each(MODEL_KEYS)("accepts canonical key %j", (key) => {
    expect(ModelKeySchema.safeParse(key).success).toBe(true);
  });

  it.each([
    "gpt-4",
    "claude-opus-4", // raw-ID fragment, not a canonical key
    "Claude-Opus",
    "",
    42,
    null,
  ])("rejects non-canonical value %j", (value) => {
    expect(ModelKeySchema.safeParse(value).success).toBe(false);
  });
});

describe("normalizeModelId", () => {
  it.each([
    // New-style family-first IDs with version/date suffixes.
    ["anthropic.claude-opus-4-20250514-v1:0", "claude-opus"],
    ["anthropic.claude-opus-4-1-20250805-v1:0", "claude-opus"],
    ["anthropic.claude-sonnet-4-20250514-v1:0", "claude-sonnet"],
    ["anthropic.claude-sonnet-4-5-20250929-v1:0", "claude-sonnet"],
    ["anthropic.claude-haiku-4-5-20251001-v1:0", "claude-haiku"],
    // Old-style generation-first IDs.
    ["anthropic.claude-3-5-sonnet-20241022-v2:0", "claude-sonnet"],
    ["anthropic.claude-3-5-haiku-20241022-v1:0", "claude-haiku"],
    ["anthropic.claude-3-opus-20240229-v1:0", "claude-opus"],
    ["anthropic.claude-3-haiku-20240307-v1:0", "claude-haiku"],
    // Family token with no version/date suffix at all.
    ["anthropic.claude-opus", "claude-opus"],
  ] as const)("maps %s to %s", (rawId, expected) => {
    expect(normalizeModelId(rawId)).toBe(expected);
  });

  it.each([
    ["us.anthropic.claude-opus-4-20250514-v1:0", "claude-opus"],
    ["eu.anthropic.claude-sonnet-4-20250514-v1:0", "claude-sonnet"],
    ["apac.anthropic.claude-3-5-haiku-20241022-v1:0", "claude-haiku"],
    ["global.anthropic.claude-sonnet-4-5-20250929-v1:0", "claude-sonnet"],
    ["jp.anthropic.claude-haiku-4-5-20251001-v1:0", "claude-haiku"],
  ] as const)("strips the region prefix: %s -> %s", (rawId, expected) => {
    expect(normalizeModelId(rawId)).toBe(expected);
  });

  it("ignores the :N inference-profile suffix", () => {
    expect(normalizeModelId("anthropic.claude-sonnet-4-20250514-v1:28")).toBe(
      "claude-sonnet",
    );
  });

  it("matches the family token only on a segment boundary", () => {
    // "sonnetx" must not match "sonnet".
    expect(normalizeModelId("anthropic.claude-sonnetx-v1:0")).toBe("other");
    expect(normalizeModelId("anthropic.claude-4-opusish-v1:0")).toBe("other");
  });

  it("is case-sensitive: raw Bedrock IDs are lowercase", () => {
    expect(normalizeModelId("Anthropic.Claude-Sonnet-4-20250514-v1:0")).toBe(
      "other",
    );
    expect(normalizeModelId("US.anthropic.claude-opus-4-20250514-v1:0")).toBe(
      "other",
    );
  });

  it("maps ARN-style identifiers to other (callers pass bare model IDs)", () => {
    expect(
      normalizeModelId(
        "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0",
      ),
    ).toBe("other");
  });

  it.each([
    "amazon.titan-text-express-v1",
    "meta.llama3-70b-instruct-v1:0",
    "mistral.mistral-large-2402-v1:0",
    // Legacy Claude without a mapped family token.
    "anthropic.claude-v2:1",
    "anthropic.claude-instant-v1",
    "",
  ])("maps unrecognized ID %j to other", (rawId) => {
    expect(normalizeModelId(rawId)).toBe("other");
  });

  it("does not treat a family token embedded in another vendor's ID as Claude", () => {
    expect(normalizeModelId("acme.sonnet-clone-v1")).toBe("other");
  });
});

describe("MODEL_META", () => {
  it("covers every canonical key with a display name and CSS token (no raw hex)", () => {
    for (const key of MODEL_KEYS) {
      const meta = MODEL_META[key];
      expect(meta.displayName.length).toBeGreaterThan(0);
      expect(meta.chartToken).toMatch(/^--color-model-[a-z]+$/);
      expect(meta.chartToken).not.toMatch(/#/);
    }
  });

  it("maps the spec display names", () => {
    expect(MODEL_META["claude-opus"].displayName).toBe("Claude Opus");
    expect(MODEL_META["claude-sonnet"].displayName).toBe("Claude Sonnet");
    expect(MODEL_META["claude-haiku"].displayName).toBe("Claude Haiku");
    expect(MODEL_META.other.displayName).toBe("Other models");
  });
});
