import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invokeOnce } from "../src/invoke.js";

type SendArg = { constructor: { name: string }; input: unknown };

class FakeSTSClient {
  public sent: SendArg[] = [];
  public assumeResponse: unknown = {
    Credentials: {
      AccessKeyId: "AKIA-TEST",
      SecretAccessKey: "secret-test",
      SessionToken: "token-test",
      Expiration: new Date("2030-01-01T00:00:00Z"),
    },
  };
  public assumeError: Error | null = null;
  send = async (cmd: SendArg): Promise<unknown> => {
    this.sent.push(cmd);
    if (this.assumeError !== null) throw this.assumeError;
    return this.assumeResponse;
  };
}

class FakeBedrockClient {
  public sent: SendArg[] = [];
  public response: unknown = {
    body: new TextEncoder().encode(
      JSON.stringify({
        content: [{ text: "ok" }],
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: "end_turn",
      }),
    ),
  };
  public error: Error | null = null;
  send = async (cmd: SendArg): Promise<unknown> => {
    this.sent.push(cmd);
    if (this.error !== null) throw this.error;
    return this.response;
  };
}

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
} as const;

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

describe("invokeOnce", () => {
  let saved: Record<string, string | undefined>;
  let sts: FakeSTSClient;
  let bedrock: FakeBedrockClient;

  beforeEach(() => {
    saved = snapshot();
    for (const [k, v] of Object.entries(ENV_VARS_TO_SET)) process.env[k] = v;
    sts = new FakeSTSClient();
    bedrock = new FakeBedrockClient();
  });
  afterEach(() => {
    restore(saved);
    vi.restoreAllMocks();
  });

  const runIt = (
    overrides: Partial<Parameters<typeof invokeOnce>[0]> = {},
  ): ReturnType<typeof invokeOnce> =>
    invokeOnce({
      user: "engineering",
      service: "chat",
      model: "claude-sonnet",
      prompt: "hi",
      maxTokens: 200,
      useGuardrail: false,
      guardrailId: undefined,
      guardrailVersion: undefined,
      region: "us-east-1",
      stsClient: sts as unknown as Parameters<typeof invokeOnce>[0]["stsClient"],
      bedrockClientFactory: () =>
        bedrock as unknown as ReturnType<
          NonNullable<Parameters<typeof invokeOnce>[0]["bedrockClientFactory"]>
        >,
      ...overrides,
    });

  it("calls AssumeRole with the expected role ARN", async () => {
    await runIt({ user: "research" });
    expect(sts.sent).toHaveLength(1);
    const cmd = sts.sent[0];
    expect(cmd).toBeDefined();
    const input = cmd?.input as { RoleArn?: string };
    expect(input.RoleArn).toBe(
      "arn:aws:iam::111111111111:role/SimUserRole-research",
    );
  });

  it("calls InvokeModel with the resolved invoke target — application inference profile when model matches the profile's wrapped model", async () => {
    // chat profile wraps claude-sonnet — so calling sonnet via chat should go
    // through the application inference profile, preserving the service tag.
    await runIt({ service: "chat", model: "claude-sonnet" });
    expect(bedrock.sent).toHaveLength(1);
    const cmd = bedrock.sent[0];
    expect(cmd).toBeDefined();
    const input = cmd?.input as { modelId?: string };
    expect(input.modelId).toBe(
      "arn:aws:bedrock:us-east-1:111111111111:inference-profile/chat",
    );
  });

  it("falls back to the model invoke ID when the service profile does not wrap the requested model", async () => {
    // chat wraps sonnet — calling opus via chat falls back to the opus
    // cross-region profile ID so per-model attribution remains accurate.
    await runIt({ service: "chat", model: "claude-opus" });
    const cmd = bedrock.sent[0];
    const input = cmd?.input as { modelId?: string };
    expect(input.modelId).toBe("us.anthropic.claude-opus-test");
  });

  it("includes guardrail params when useGuardrail is true", async () => {
    await runIt({
      useGuardrail: true,
      guardrailId: "gr-abc",
      guardrailVersion: "1",
    });
    const cmd = bedrock.sent[0];
    const input = cmd?.input as {
      guardrailIdentifier?: string;
      guardrailVersion?: string;
    };
    expect(input.guardrailIdentifier).toBe("gr-abc");
    expect(input.guardrailVersion).toBe("1");
  });

  it("omits guardrail params when useGuardrail is false", async () => {
    await runIt({ useGuardrail: false });
    const cmd = bedrock.sent[0];
    const input = cmd?.input as {
      guardrailIdentifier?: string;
      guardrailVersion?: string;
    };
    expect(input.guardrailIdentifier).toBeUndefined();
    expect(input.guardrailVersion).toBeUndefined();
  });

  it("returns status='error' with errorCode='AccessDeniedException' when InvokeModel throws", async () => {
    const err: Error & { name: string } = Object.assign(
      new Error("not authorised"),
      { name: "AccessDeniedException" },
    );
    bedrock.error = err;
    const result = await runIt();
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("AccessDeniedException");
    expect(result.errorMessage).toBe("not authorised");
  });

  it("returns status='error' when AssumeRole throws — never propagates", async () => {
    sts.assumeError = Object.assign(new Error("no perm"), {
      name: "AccessDenied",
    });
    const result = await runIt();
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("AccessDenied");
  });

  it("returns status='guardrailBlocked' when the response indicates an intervention via stop_reason", async () => {
    bedrock.response = {
      body: new TextEncoder().encode(
        JSON.stringify({
          stop_reason: "guardrail_intervened",
          usage: { input_tokens: 5, output_tokens: 0 },
        }),
      ),
    };
    const result = await runIt({
      useGuardrail: true,
      guardrailId: "gr-abc",
      guardrailVersion: "1",
    });
    expect(result.status).toBe("guardrailBlocked");
    expect(result.guardrailIntervention).toBe(true);
  });

  it("returns status='guardrailBlocked' when the response carries an amazon-bedrock-trace with BLOCKED action", async () => {
    bedrock.response = {
      body: new TextEncoder().encode(
        JSON.stringify({
          stop_reason: "end_turn",
          "amazon-bedrock-trace": {
            guardrail: { outputAssessments: [{ action: "BLOCKED" }] },
          },
          usage: { input_tokens: 5, output_tokens: 0 },
        }),
      ),
    };
    const result = await runIt({
      useGuardrail: true,
      guardrailId: "gr-abc",
      guardrailVersion: "1",
    });
    expect(result.status).toBe("guardrailBlocked");
    expect(result.guardrailIntervention).toBe(true);
  });

  it("extracts input/output tokens from Anthropic usage block on success", async () => {
    const result = await runIt();
    expect(result.status).toBe("success");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(20);
  });

  it("extracts tokens from Llama-style response for the 'other' model", async () => {
    bedrock.response = {
      body: new TextEncoder().encode(
        JSON.stringify({
          generation: "ok",
          prompt_token_count: 7,
          generation_token_count: 11,
          stop_reason: "stop",
        }),
      ),
    };
    const result = await runIt({ model: "other", service: "translator" });
    expect(result.status).toBe("success");
    expect(result.inputTokens).toBe(7);
    expect(result.outputTokens).toBe(11);
  });

  it("returns null token counts when the response body cannot be parsed", async () => {
    bedrock.response = { body: new TextEncoder().encode("not-json") };
    const result = await runIt();
    expect(result.status).toBe("success");
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });

  it("errors with a clear message when useGuardrail=true but guardrail IDs are missing", async () => {
    const result = await runIt({
      useGuardrail: true,
      guardrailId: undefined,
      guardrailVersion: undefined,
    });
    expect(result.status).toBe("error");
    expect(result.errorMessage).toMatch(/guardrailId|guardrailVersion/);
  });

  it("records the user / service / model triple on the returned result", async () => {
    const result = await runIt({
      user: "marketing",
      service: "summarizer",
      model: "claude-haiku",
    });
    expect(result.user).toBe("marketing");
    expect(result.service).toBe("summarizer");
    expect(result.model).toBe("claude-haiku");
  });

  // Spec — Attribution model "Per-user": the Lambda assumes
  // SimUserRole-<user> per call. CloudTrail records the assumed-role name.
  it.each([
    [
      "engineering",
      "arn:aws:iam::111111111111:role/SimUserRole-engineering",
    ] as const,
    [
      "research",
      "arn:aws:iam::111111111111:role/SimUserRole-research",
    ] as const,
    [
      "marketing",
      "arn:aws:iam::111111111111:role/SimUserRole-marketing",
    ] as const,
  ])("assumes SimUserRole-%s with the correct ARN", async (user, arn) => {
    await runIt({ user });
    const input = sts.sent[0]?.input as { RoleArn?: string };
    expect(input.RoleArn).toBe(arn);
  });

  it("RoleSessionName encodes the user name (CloudTrail attribution hint)", async () => {
    await runIt({ user: "research" });
    const input = sts.sent[0]?.input as { RoleSessionName?: string };
    expect(input.RoleSessionName).toMatch(/^bedrock-simulator-research-/);
  });

  // Per-call errors do not abort the run — spec "Lambda contract / Response
  // shape".
  it("returns status='error' with errorCode='ThrottlingException' when InvokeModel throws ThrottlingException", async () => {
    bedrock.error = Object.assign(new Error("Rate exceeded"), {
      name: "ThrottlingException",
    });
    const result = await runIt();
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("ThrottlingException");
    expect(result.errorMessage).toBe("Rate exceeded");
  });

  it("returns status='error' with errorCode='ValidationException' when InvokeModel throws ValidationException", async () => {
    bedrock.error = Object.assign(new Error("invalid input"), {
      name: "ValidationException",
    });
    const result = await runIt();
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("ValidationException");
  });

  it("returns status='error' and does not throw when InvokeModel throws — never propagates", async () => {
    bedrock.error = Object.assign(new Error("boom"), { name: "Boom" });
    // The contract is: invokeOnce never throws (per-call errors must not abort
    // the run). Calling it should resolve, not reject.
    await expect(runIt()).resolves.toBeDefined();
  });

  it("detects a guardrail intervention via the GUARDRAIL_INTERVENED trace action", async () => {
    bedrock.response = {
      body: new TextEncoder().encode(
        JSON.stringify({
          stop_reason: "end_turn",
          "amazon-bedrock-trace": {
            guardrail: {
              inputAssessments: [{ action: "GUARDRAIL_INTERVENED" }],
            },
          },
          usage: { input_tokens: 5, output_tokens: 0 },
        }),
      ),
    };
    const result = await runIt({
      useGuardrail: true,
      guardrailId: "gr-abc",
      guardrailVersion: "1",
    });
    expect(result.status).toBe("guardrailBlocked");
    expect(result.guardrailIntervention).toBe(true);
  });

  it("detects an ANONYMIZED guardrail trace as an intervention", async () => {
    bedrock.response = {
      body: new TextEncoder().encode(
        JSON.stringify({
          stop_reason: "end_turn",
          "amazon-bedrock-trace": {
            guardrail: { outputAssessments: [{ action: "ANONYMIZED" }] },
          },
          usage: { input_tokens: 5, output_tokens: 0 },
        }),
      ),
    };
    const result = await runIt({
      useGuardrail: true,
      guardrailId: "gr-abc",
      guardrailVersion: "1",
    });
    expect(result.status).toBe("guardrailBlocked");
    expect(result.guardrailIntervention).toBe(true);
  });

  it("does NOT flag intervention when the trace exists but no blocking action is present", async () => {
    bedrock.response = {
      body: new TextEncoder().encode(
        JSON.stringify({
          stop_reason: "end_turn",
          "amazon-bedrock-trace": {
            guardrail: { inputAssessments: [{ action: "NONE" }] },
          },
          usage: { input_tokens: 5, output_tokens: 0 },
        }),
      ),
    };
    const result = await runIt({
      useGuardrail: true,
      guardrailId: "gr-abc",
      guardrailVersion: "1",
    });
    expect(result.status).toBe("success");
    expect(result.guardrailIntervention).toBe(false);
  });

  it("falls back to the bare invoke ID for translator (wraps 'other') when called with claude-haiku", async () => {
    // translator's profile wraps 'other'; calling haiku via translator falls
    // back to the haiku bare invoke ID so per-model attribution is preserved.
    await runIt({ service: "translator", model: "claude-haiku" });
    const cmd = bedrock.sent[0];
    const input = cmd?.input as { modelId?: string };
    expect(input.modelId).toBe("anthropic.claude-3-5-haiku-test");
  });

  it("routes via the summarizer profile when called with the wrapped haiku model", async () => {
    // summarizer wraps haiku.
    await runIt({ service: "summarizer", model: "claude-haiku" });
    const cmd = bedrock.sent[0];
    const input = cmd?.input as { modelId?: string };
    expect(input.modelId).toBe(
      "arn:aws:bedrock:us-east-1:111111111111:inference-profile/summarizer",
    );
  });

  it("routes via the translator profile when called with the wrapped 'other' model", async () => {
    await runIt({ service: "translator", model: "other" });
    const cmd = bedrock.sent[0];
    const input = cmd?.input as { modelId?: string };
    expect(input.modelId).toBe(
      "arn:aws:bedrock:us-east-1:111111111111:inference-profile/translator",
    );
  });

  it("sends an InvokeModelCommand (not some other Bedrock command)", async () => {
    await runIt();
    expect(bedrock.sent[0]?.constructor.name).toBe("InvokeModelCommand");
  });

  // Spec — Response shape (output): inputTokens / outputTokens / latencyMs
  // contracts on the error path. Tokens are null and latencyMs is a finite
  // non-negative integer even when the underlying call throws.
  it("returns null token counts and a non-negative latencyMs on error", async () => {
    bedrock.error = Object.assign(new Error("boom"), { name: "Boom" });
    const result = await runIt();
    expect(result.status).toBe("error");
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
    expect(result.guardrailIntervention).toBe(false);
    expect(Number.isFinite(result.latencyMs)).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  // The Anthropic request body the simulator builds must carry the documented
  // anthropic_version constant and a max_tokens cap matching what the handler
  // resolved. Llama bodies look different — exercise both.
  it("builds an Anthropic request body with anthropic_version and max_tokens", async () => {
    await runIt({
      model: "claude-haiku",
      service: "summarizer",
      maxTokens: 1000,
    });
    const cmd = bedrock.sent[0];
    const input = cmd?.input as { body?: Uint8Array };
    expect(input.body).toBeDefined();
    const decoded = new TextDecoder().decode(input.body);
    const parsed = JSON.parse(decoded) as {
      anthropic_version?: string;
      max_tokens?: number;
      messages?: Array<{ role: string; content: string }>;
    };
    expect(parsed.anthropic_version).toBe("bedrock-2023-05-31");
    expect(parsed.max_tokens).toBe(1000);
    expect(parsed.messages?.[0]?.role).toBe("user");
  });

  it("builds a Llama request body with prompt and max_gen_len for the 'other' model", async () => {
    await runIt({ model: "other", service: "translator", maxTokens: 200 });
    const cmd = bedrock.sent[0];
    const input = cmd?.input as { body?: Uint8Array };
    expect(input.body).toBeDefined();
    const decoded = new TextDecoder().decode(input.body);
    const parsed = JSON.parse(decoded) as {
      prompt?: string;
      max_gen_len?: number;
    };
    expect(parsed.prompt).toBeDefined();
    expect(parsed.max_gen_len).toBe(200);
  });
});
