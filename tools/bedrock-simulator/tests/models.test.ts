import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getInvokeId, MODEL_KEYS } from "../src/models.js";

const ENV_VARS = [
  "CLAUDE_OPUS_INVOKE_ID",
  "CLAUDE_SONNET_INVOKE_ID",
  "CLAUDE_HAIKU_INVOKE_ID",
  "OTHER_INVOKE_ID",
] as const;

const snapshot = (): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {};
  for (const v of ENV_VARS) out[v] = process.env[v];
  return out;
};

const restore = (snap: Record<string, string | undefined>): void => {
  for (const v of ENV_VARS) {
    const prior = snap[v];
    if (prior === undefined) {
      delete process.env[v];
    } else {
      process.env[v] = prior;
    }
  }
};

describe("models.ts registry", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = snapshot();
  });
  afterEach(() => {
    restore(saved);
  });

  it("each canonical key resolves to its env-var-derived invoke ID", () => {
    process.env["CLAUDE_OPUS_INVOKE_ID"] = "us.anthropic.claude-opus-test";
    process.env["CLAUDE_SONNET_INVOKE_ID"] = "us.anthropic.claude-sonnet-test";
    process.env["CLAUDE_HAIKU_INVOKE_ID"] = "anthropic.claude-3-5-haiku-test";
    process.env["OTHER_INVOKE_ID"] = "meta.llama-test";

    expect(getInvokeId("claude-opus")).toBe("us.anthropic.claude-opus-test");
    expect(getInvokeId("claude-sonnet")).toBe(
      "us.anthropic.claude-sonnet-test",
    );
    expect(getInvokeId("claude-haiku")).toBe("anthropic.claude-3-5-haiku-test");
    expect(getInvokeId("other")).toBe("meta.llama-test");
  });

  it("throws a clear error naming the missing env var", () => {
    delete process.env["CLAUDE_OPUS_INVOKE_ID"];
    expect(() => getInvokeId("claude-opus")).toThrowError(
      /CLAUDE_OPUS_INVOKE_ID/,
    );
  });

  it("throws when env var is the empty string", () => {
    process.env["OTHER_INVOKE_ID"] = "";
    expect(() => getInvokeId("other")).toThrowError(/OTHER_INVOKE_ID/);
  });

  it("MODEL_KEYS lists exactly the four canonical keys", () => {
    expect([...MODEL_KEYS].sort()).toEqual(
      ["claude-haiku", "claude-opus", "claude-sonnet", "other"].sort(),
    );
  });
});
