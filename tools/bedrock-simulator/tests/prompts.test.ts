import { describe, expect, it } from "vitest";

import {
  estimateInputTokens,
  getAllPrompts,
  getPromptsForService,
  PROMPT_INPUT_TOKEN_CAP,
} from "../src/prompts.js";
import { SERVICE_KEYS } from "../src/profiles.js";

describe("prompts.ts cost cap", () => {
  it("every fixture is at or under the input-token cap", () => {
    const all = getAllPrompts();
    expect(all.length).toBeGreaterThan(0);
    for (const prompt of all) {
      const tokens = estimateInputTokens(prompt);
      expect(
        tokens,
        `fixture exceeds ${PROMPT_INPUT_TOKEN_CAP}-token cap (got ${tokens}): "${prompt.slice(0, 60)}…"`,
      ).toBeLessThanOrEqual(PROMPT_INPUT_TOKEN_CAP);
    }
  });

  it("estimator uses chars/4 rounded up", () => {
    expect(estimateInputTokens("")).toBe(0);
    expect(estimateInputTokens("abcd")).toBe(1);
    expect(estimateInputTokens("abcde")).toBe(2);
    expect(estimateInputTokens("a".repeat(2000))).toBe(500);
    expect(estimateInputTokens("a".repeat(2001))).toBe(501);
  });

  it("each service exposes at least the three guardrail-tripping fixtures", () => {
    for (const service of SERVICE_KEYS) {
      const prompts = getPromptsForService(service);
      // Three safe + three guardrail-tripping minimum.
      expect(prompts.length).toBeGreaterThanOrEqual(6);
      // The AU TFN, IBAN, and insult fixtures must be present in every service
      // pool so any random pick can produce an intervention.
      const joined = prompts.join("\n");
      expect(joined).toContain("123 456 789");
      expect(joined).toContain("GB29 NWBK 6016 1331 9268 19");
      expect(joined.toLowerCase()).toMatch(/useless|waste/);
    }
  });
});
