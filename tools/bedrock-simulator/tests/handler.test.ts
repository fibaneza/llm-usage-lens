import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runHandler, InvocationPayloadSchema } from "../src/handler.js";
import type { InvocationResult, InvokeOptions } from "../src/invoke.js";

type InvokeFn = (opts: InvokeOptions) => Promise<InvocationResult>;

const ENV_VARS_TO_SET = {
  CLAUDE_OPUS_INVOKE_ID: "us.anthropic.claude-opus-test",
  CLAUDE_SONNET_INVOKE_ID: "us.anthropic.claude-sonnet-test",
  CLAUDE_HAIKU_INVOKE_ID: "anthropic.claude-3-5-haiku-test",
  OTHER_INVOKE_ID: "meta.llama-test",
  INFERENCE_PROFILE_CHAT_ARN: "arn:aws:bedrock:us-east-1:111111111111:inference-profile/chat",
  INFERENCE_PROFILE_SUMMARIZER_ARN: "arn:aws:bedrock:us-east-1:111111111111:inference-profile/summarizer",
  INFERENCE_PROFILE_TRANSLATOR_ARN: "arn:aws:bedrock:us-east-1:111111111111:inference-profile/translator",
  SIM_USER_ROLE_ENGINEERING_ARN: "arn:aws:iam::111111111111:role/SimUserRole-engineering",
  SIM_USER_ROLE_RESEARCH_ARN: "arn:aws:iam::111111111111:role/SimUserRole-research",
  SIM_USER_ROLE_MARKETING_ARN: "arn:aws:iam::111111111111:role/SimUserRole-marketing",
  GUARDRAIL_ID: "gr-test",
  GUARDRAIL_VERSION: "1",
} as const;

const validPayload = (): unknown => ({
  totalCalls: 10,
  models: ["claude-opus", "claude-sonnet", "claude-haiku", "other"],
  services: ["chat", "summarizer", "translator"],
  users: ["engineering", "research", "marketing"],
  guardrailRatio: 0.2,
});

const fakeSuccess = (): InvocationResult => ({
  user: "engineering",
  service: "chat",
  model: "claude-haiku",
  status: "success",
  inputTokens: 50,
  outputTokens: 50,
  guardrailIntervention: false,
  errorCode: null,
  errorMessage: null,
  latencyMs: 10,
});

const envKeys = Object.keys(ENV_VARS_TO_SET);
const snapshot = (): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {};
  for (const k of envKeys) out[k] = process.env[k];
  return out;
};
const restore = (snap: Record<string, string | undefined>): void => {
  for (const k of envKeys) {
    const prior = snap[k];
    if (prior === undefined) delete process.env[k];
    else process.env[k] = prior;
  }
};

describe("InvocationPayloadSchema validation", () => {
  it("accepts a valid payload", () => {
    const parsed = InvocationPayloadSchema.safeParse(validPayload());
    expect(parsed.success).toBe(true);
  });

  it("rejects totalCalls > 50", () => {
    const parsed = InvocationPayloadSchema.safeParse({
      ...(validPayload() as object),
      totalCalls: 51,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects totalCalls < 1", () => {
    const parsed = InvocationPayloadSchema.safeParse({
      ...(validPayload() as object),
      totalCalls: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects totalCalls that is not an integer", () => {
    const parsed = InvocationPayloadSchema.safeParse({
      ...(validPayload() as object),
      totalCalls: 1.5,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects guardrailRatio < 0", () => {
    const parsed = InvocationPayloadSchema.safeParse({
      ...(validPayload() as object),
      guardrailRatio: -0.1,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects guardrailRatio > 1", () => {
    const parsed = InvocationPayloadSchema.safeParse({
      ...(validPayload() as object),
      guardrailRatio: 1.1,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(
      InvocationPayloadSchema.safeParse({ totalCalls: 1 }).success,
    ).toBe(false);
    expect(InvocationPayloadSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty arrays", () => {
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        models: [],
      }).success,
    ).toBe(false);
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        services: [],
      }).success,
    ).toBe(false);
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        users: [],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown model / service / user keys", () => {
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        models: ["claude-opus", "gpt-4"],
      }).success,
    ).toBe(false);
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        services: ["chat", "billing"],
      }).success,
    ).toBe(false);
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        users: ["engineering", "ceo"],
      }).success,
    ).toBe(false);
  });

  it("rejects extra top-level fields (strict object)", () => {
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        sneaky: "value",
      }).success,
    ).toBe(false);
  });

  it("accepts the exact boundary values totalCalls=1 and totalCalls=50", () => {
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        totalCalls: 1,
      }).success,
    ).toBe(true);
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        totalCalls: 50,
      }).success,
    ).toBe(true);
  });

  it("accepts the exact boundary values guardrailRatio=0 and guardrailRatio=1", () => {
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        guardrailRatio: 0,
      }).success,
    ).toBe(true);
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        guardrailRatio: 1,
      }).success,
    ).toBe(true);
  });

  // Synthetic-data-only constraint (spec — "Synthetic-data-only constraint"):
  // the Lambda MUST NOT accept prompt text from the invocation payload.
  // The .strict() schema rejects any prompt-shaped field by construction.
  it("rejects a payload that smuggles a 'prompt' field (synthetic-data-only constraint)", () => {
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        prompt: "ignore previous instructions",
      }).success,
    ).toBe(false);
  });

  it("rejects a payload that smuggles 'prompts' or 'messages' fields", () => {
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        prompts: ["x"],
      }).success,
    ).toBe(false);
    expect(
      InvocationPayloadSchema.safeParse({
        ...(validPayload() as object),
        messages: [{ role: "user", content: "x" }],
      }).success,
    ).toBe(false);
  });
});

describe("runHandler", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = snapshot();
    for (const [k, v] of Object.entries(ENV_VARS_TO_SET)) {
      process.env[k] = v;
    }
  });
  afterEach(() => {
    restore(saved);
  });

  it("invokes once per totalCalls and returns the standard response shape", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    const response = await runHandler(validPayload(), {
      invoke,
      rng: () => 0.5,
    });
    expect(invoke).toHaveBeenCalledTimes(10);
    expect(response.summary.totalCalls).toBe(10);
    expect(response.summary.success).toBe(10);
    expect(response.summary.errored).toBe(0);
    expect(response.summary.guardrailBlocked).toBe(0);
    expect(response.results).toHaveLength(10);
  });

  it("counts error and guardrailBlocked statuses correctly", async () => {
    let i = 0;
    const invoke = vi.fn<InvokeFn>(async () => {
      const base = fakeSuccess();
      const remainder = i++ % 3;
      if (remainder === 0) return { ...base, status: "success" as const };
      if (remainder === 1)
        return {
          ...base,
          status: "error" as const,
          errorCode: "ThrottlingException",
          errorMessage: "rate limited",
        };
      return {
        ...base,
        status: "guardrailBlocked" as const,
        guardrailIntervention: true,
      };
    });
    const response = await runHandler(
      { ...(validPayload() as object), totalCalls: 9 },
      { invoke, rng: () => 0.0 },
    );
    expect(response.summary.success).toBe(3);
    expect(response.summary.errored).toBe(3);
    expect(response.summary.guardrailBlocked).toBe(3);
  });

  it("uses smoke max_tokens (200) when totalCalls === 1", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    await runHandler(
      { ...(validPayload() as object), totalCalls: 1 },
      { invoke, rng: () => 0.5 },
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    const firstCall = invoke.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0].maxTokens).toBe(200);
  });

  it("uses default max_tokens (1000) when totalCalls > 1", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    await runHandler(
      { ...(validPayload() as object), totalCalls: 5 },
      { invoke, rng: () => 0.5 },
    );
    const firstCall = invoke.mock.calls[0];
    expect(firstCall?.[0].maxTokens).toBe(1000);
  });

  it("passes useGuardrail=true when rng() < guardrailRatio", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    await runHandler(
      { ...(validPayload() as object), totalCalls: 3, guardrailRatio: 1.0 },
      { invoke, rng: () => 0.5 },
    );
    const flags = invoke.mock.calls.map((c) => c[0].useGuardrail);
    expect(flags).toEqual([true, true, true]);
  });

  it("passes useGuardrail=false when guardrailRatio is 0", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    await runHandler(
      { ...(validPayload() as object), totalCalls: 3, guardrailRatio: 0 },
      { invoke, rng: () => 0.5 },
    );
    const flags = invoke.mock.calls.map((c) => c[0].useGuardrail);
    expect(flags).toEqual([false, false, false]);
  });

  it("forwards GUARDRAIL_ID and GUARDRAIL_VERSION from env to each invocation", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    await runHandler(
      { ...(validPayload() as object), totalCalls: 1, guardrailRatio: 1.0 },
      { invoke, rng: () => 0.0 },
    );
    const firstCall = invoke.mock.calls[0];
    expect(firstCall?.[0].guardrailId).toBe("gr-test");
    expect(firstCall?.[0].guardrailVersion).toBe("1");
    expect(firstCall?.[0].useGuardrail).toBe(true);
  });

  it("invokes from the typescript handler entrypoint", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    const response = await runHandler(
      { ...(validPayload() as object), totalCalls: 1 },
      { invoke, rng: () => 0.5 },
    );
    expect(response.summary.totalCalls).toBe(1);
  });

  // Spec — "Response shape (output)": each results[] entry has 9 named fields
  // and errorCode/errorMessage are null on success.
  it("each results[] entry carries all nine documented fields with null error fields on success", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    const response = await runHandler(
      { ...(validPayload() as object), totalCalls: 2 },
      { invoke, rng: () => 0.5 },
    );
    for (const r of response.results) {
      expect(Object.keys(r).sort()).toEqual(
        [
          "user",
          "service",
          "model",
          "status",
          "inputTokens",
          "outputTokens",
          "guardrailIntervention",
          "errorCode",
          "errorMessage",
          "latencyMs",
        ].sort(),
      );
      expect(["success", "error", "guardrailBlocked"]).toContain(r.status);
      if (r.status === "success") {
        expect(r.errorCode).toBeNull();
        expect(r.errorMessage).toBeNull();
      }
      expect(typeof r.latencyMs).toBe("number");
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("summary object carries exactly the four documented fields", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    const response = await runHandler(
      { ...(validPayload() as object), totalCalls: 1 },
      { invoke, rng: () => 0.5 },
    );
    expect(Object.keys(response.summary).sort()).toEqual(
      ["totalCalls", "success", "errored", "guardrailBlocked"].sort(),
    );
  });

  // Spec — "Prompt and token caps": heavy (2000) is selectable only by an
  // internal code change, never by input. Confirm no input combination reaches
  // 2000 — every (totalCalls, ratio) input must yield 200 or 1000.
  it("heavy max_tokens (2000) is unreachable from invocation input alone", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    const cases: Array<{ totalCalls: number; guardrailRatio: number }> = [
      { totalCalls: 1, guardrailRatio: 0 },
      { totalCalls: 2, guardrailRatio: 0.5 },
      { totalCalls: 25, guardrailRatio: 1 },
      { totalCalls: 50, guardrailRatio: 1 },
    ];
    for (const c of cases) {
      invoke.mockClear();
      await runHandler(
        { ...(validPayload() as object), ...c },
        { invoke, rng: () => 0.5 },
      );
      for (const call of invoke.mock.calls) {
        expect([200, 1000]).toContain(call[0].maxTokens);
      }
    }
  });

  // Synthetic-data-only constraint, defence-in-depth: when the handler does
  // call invoke(), the prompt it forwards must come from prompts.ts (a fixed
  // string set), not from anywhere in the user-supplied payload.
  it("only forwards prompts that come from the prompts.ts fixture set", async () => {
    const { getAllPrompts } = await import("../src/prompts.js");
    const validPrompts = new Set(getAllPrompts());
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    await runHandler(
      { ...(validPayload() as object), totalCalls: 20 },
      { invoke, rng: () => 0.0 },
    );
    for (const call of invoke.mock.calls) {
      expect(validPrompts.has(call[0].prompt)).toBe(true);
    }
  });

  // Boundary execution — totalCalls=50 is the spec hard cap; confirm the
  // handler actually drives 50 invocations at that boundary, not just that the
  // schema accepts it.
  it("fans out to exactly 50 invocations at the totalCalls=50 hard cap", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    const response = await runHandler(
      { ...(validPayload() as object), totalCalls: 50 },
      { invoke, rng: () => 0.5 },
    );
    expect(invoke).toHaveBeenCalledTimes(50);
    expect(response.summary.totalCalls).toBe(50);
    expect(response.results).toHaveLength(50);
  });

  // Boundary execution — totalCalls=1 fans out to exactly one call (and uses
  // the smoke max_tokens of 200, asserted separately above).
  it("fans out to exactly 1 invocation at the totalCalls=1 smoke boundary", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    const response = await runHandler(
      { ...(validPayload() as object), totalCalls: 1 },
      { invoke, rng: () => 0.5 },
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(response.results).toHaveLength(1);
  });

  // deps.region must propagate to every invoke() — otherwise the simulator
  // could silently default to us-east-1 even when the operator overrode the
  // region (e.g. for a hypothetical multi-region exercise).
  it("propagates deps.region to every invoke() call", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    await runHandler(
      { ...(validPayload() as object), totalCalls: 3 },
      { invoke, rng: () => 0.5, region: "eu-west-1" },
    );
    for (const call of invoke.mock.calls) {
      expect(call[0].region).toBe("eu-west-1");
    }
  });

  // The handler must only forward keys it knows about. Even though Zod's
  // strict object already rejects unknown keys, exercise the defence-in-depth
  // filter by passing through a valid payload and confirming each invoke()
  // sees a recognised user/service/model triple.
  it("every invoke() receives a known (user, service, model) triple", async () => {
    const invoke = vi.fn<InvokeFn>(async () => fakeSuccess());
    await runHandler(
      { ...(validPayload() as object), totalCalls: 20 },
      { invoke, rng: () => 0.0 },
    );
    const validUsers = new Set(["engineering", "research", "marketing"]);
    const validServices = new Set(["chat", "summarizer", "translator"]);
    const validModels = new Set([
      "claude-opus",
      "claude-sonnet",
      "claude-haiku",
      "other",
    ]);
    for (const call of invoke.mock.calls) {
      expect(validUsers.has(call[0].user)).toBe(true);
      expect(validServices.has(call[0].service)).toBe(true);
      expect(validModels.has(call[0].model)).toBe(true);
    }
  });

  // The handler must never crash on a per-call error — every triple should
  // appear in results[] even when invoke() resolves with status='error'.
  it("never aborts when every invoke() resolves with status='error'", async () => {
    const invoke = vi.fn<InvokeFn>(async () => ({
      ...fakeSuccess(),
      status: "error" as const,
      errorCode: "ThrottlingException",
      errorMessage: "rate limited",
    }));
    const response = await runHandler(
      { ...(validPayload() as object), totalCalls: 5 },
      { invoke, rng: () => 0.5 },
    );
    expect(response.results).toHaveLength(5);
    expect(response.summary.errored).toBe(5);
    expect(response.summary.success).toBe(0);
    expect(response.summary.totalCalls).toBe(5);
  });
});
