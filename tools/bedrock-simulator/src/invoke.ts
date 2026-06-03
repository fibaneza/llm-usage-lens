import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";

import { getInvokeId, type CanonicalModelKey } from "./models.js";
import {
  getInferenceProfileArn,
  getSimUserRoleArn,
  type ServiceKey,
  type UserKey,
} from "./profiles.js";

export type InvocationStatus = "success" | "error" | "guardrailBlocked";

export type InvocationResult = {
  user: UserKey;
  service: ServiceKey;
  model: CanonicalModelKey;
  status: InvocationStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  guardrailIntervention: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number;
};

export type InvokeOptions = {
  user: UserKey;
  service: ServiceKey;
  model: CanonicalModelKey;
  prompt: string;
  maxTokens: number;
  useGuardrail: boolean;
  guardrailId: string | undefined;
  guardrailVersion: string | undefined;
  region: string;
  stsClient?: STSClient | undefined;
  bedrockClientFactory?:
    | ((creds: AwsTempCredentials) => BedrockRuntimeClient)
    | undefined;
};

export type AwsTempCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration?: Date;
};

const ANTHROPIC_VERSION = "bedrock-2023-05-31";

const isAnthropicModel = (model: CanonicalModelKey): boolean =>
  model === "claude-opus" ||
  model === "claude-sonnet" ||
  model === "claude-haiku";

const buildAnthropicBody = (prompt: string, maxTokens: number): string =>
  JSON.stringify({
    anthropic_version: ANTHROPIC_VERSION,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

const buildLlamaBody = (prompt: string, maxTokens: number): string =>
  JSON.stringify({
    prompt,
    max_gen_len: maxTokens,
    temperature: 0.5,
  });

const buildRequestBody = (
  model: CanonicalModelKey,
  prompt: string,
  maxTokens: number,
): string =>
  isAnthropicModel(model)
    ? buildAnthropicBody(prompt, maxTokens)
    : buildLlamaBody(prompt, maxTokens);

// modelId on InvokeModel: for Claude Opus/Sonnet we pass the us.* cross-region
// inference profile ID via env (see template.yaml CLAUDE_OPUS_INVOKE_ID); for
// Haiku and "other" we pass the bare foundation-model ID. For per-service
// attribution the spec routes via the application inference profile (tagged
// service=<name>) when the model the profile wraps matches; otherwise we fall
// back to the model invoke ID directly. Either way per-model attribution is
// preserved by CloudWatch's AWS/Bedrock model dimension.
const resolveInvokeTarget = (
  model: CanonicalModelKey,
  service: ServiceKey,
): string => {
  // The application inference profile tagged with the service name is the
  // attribution carrier for the service dimension (Attribution model spec).
  // Calling through it always yields the correct service tag, but each
  // application profile in the SAM template wraps exactly one underlying
  // model. To preserve the per-model dimension when the requested model does
  // not match the profile's wrapped model, fall back to the model invoke ID.
  const profileMap: Record<ServiceKey, CanonicalModelKey> = {
    chat: "claude-sonnet",
    summarizer: "claude-haiku",
    translator: "other",
  };
  if (profileMap[service] === model) {
    return getInferenceProfileArn(service);
  }
  return getInvokeId(model);
};

const extractInputOutputTokens = (
  model: CanonicalModelKey,
  responseBody: unknown,
): { inputTokens: number | null; outputTokens: number | null } => {
  if (
    typeof responseBody !== "object" ||
    responseBody === null
  ) {
    return { inputTokens: null, outputTokens: null };
  }
  if (isAnthropicModel(model)) {
    const usage = (responseBody as { usage?: unknown }).usage;
    if (typeof usage === "object" && usage !== null) {
      const input = (usage as { input_tokens?: unknown }).input_tokens;
      const output = (usage as { output_tokens?: unknown }).output_tokens;
      return {
        inputTokens: typeof input === "number" ? input : null,
        outputTokens: typeof output === "number" ? output : null,
      };
    }
    return { inputTokens: null, outputTokens: null };
  }
  // Llama-style response shape.
  const promptTokens = (responseBody as { prompt_token_count?: unknown })
    .prompt_token_count;
  const generationTokens = (
    responseBody as { generation_token_count?: unknown }
  ).generation_token_count;
  return {
    inputTokens: typeof promptTokens === "number" ? promptTokens : null,
    outputTokens:
      typeof generationTokens === "number" ? generationTokens : null,
  };
};

const detectGuardrailIntervention = (
  responseBody: unknown,
): boolean => {
  if (typeof responseBody !== "object" || responseBody === null) {
    return false;
  }
  // Anthropic + many other model providers surface guardrail interventions
  // via stop_reason === "guardrail_intervened" or an amazon-bedrock-* trace
  // block in the response body.
  const stopReason = (responseBody as { stop_reason?: unknown }).stop_reason;
  if (
    typeof stopReason === "string" &&
    stopReason === "guardrail_intervened"
  ) {
    return true;
  }
  const trace = (responseBody as { "amazon-bedrock-trace"?: unknown })[
    "amazon-bedrock-trace"
  ];
  if (typeof trace === "object" && trace !== null) {
    const guardrail = (trace as { guardrail?: unknown }).guardrail;
    if (guardrail !== undefined && guardrail !== null) {
      // The presence of a guardrail trace alone does not mean the response was
      // blocked. Only treat it as an intervention when an action other than
      // NONE appears in the trace payload.
      const serialized = JSON.stringify(guardrail);
      if (
        serialized.includes("\"action\":\"BLOCKED\"") ||
        serialized.includes("\"action\":\"GUARDRAIL_INTERVENED\"") ||
        serialized.includes("\"action\":\"ANONYMIZED\"")
      ) {
        return true;
      }
    }
  }
  return false;
};

const extractErrorCode = (err: unknown): string => {
  if (typeof err === "object" && err !== null) {
    const named = (err as { name?: unknown }).name;
    if (typeof named === "string" && named.length > 0) return named;
    const code = (err as { Code?: unknown }).Code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "UnknownError";
};

const extractErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unserialisable error";
  }
};

const defaultBedrockClientFactory =
  (region: string) =>
  (creds: AwsTempCredentials): BedrockRuntimeClient =>
    new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });

export const invokeOnce = async (
  opts: InvokeOptions,
): Promise<InvocationResult> => {
  const started = Date.now();
  const base: Omit<
    InvocationResult,
    "status" | "errorCode" | "errorMessage" | "latencyMs"
  > = {
    user: opts.user,
    service: opts.service,
    model: opts.model,
    inputTokens: null,
    outputTokens: null,
    guardrailIntervention: false,
  };

  try {
    if (opts.useGuardrail) {
      if (
        opts.guardrailId === undefined ||
        opts.guardrailId.length === 0 ||
        opts.guardrailVersion === undefined ||
        opts.guardrailVersion.length === 0
      ) {
        throw new Error(
          "useGuardrail is true but guardrailId or guardrailVersion is missing.",
        );
      }
    }

    const roleArn = getSimUserRoleArn(opts.user);
    const sts = opts.stsClient ?? new STSClient({ region: opts.region });
    const assume = await sts.send(
      new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: `bedrock-simulator-${opts.user}-${started}`,
        DurationSeconds: 900,
      }),
    );
    const creds = assume.Credentials;
    if (
      creds === undefined ||
      creds.AccessKeyId === undefined ||
      creds.SecretAccessKey === undefined ||
      creds.SessionToken === undefined
    ) {
      throw new Error(
        `AssumeRole on ${roleArn} returned no Credentials block.`,
      );
    }
    const temp: AwsTempCredentials = {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
      ...(creds.Expiration !== undefined ? { expiration: creds.Expiration } : {}),
    };
    const bedrock = (opts.bedrockClientFactory ??
      defaultBedrockClientFactory(opts.region))(temp);

    const modelId = resolveInvokeTarget(opts.model, opts.service);
    const body = buildRequestBody(opts.model, opts.prompt, opts.maxTokens);
    const commandInput: InvokeModelCommandInput = {
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(body),
      ...(opts.useGuardrail
        ? {
            guardrailIdentifier: opts.guardrailId,
            guardrailVersion: opts.guardrailVersion,
          }
        : {}),
    };

    const response = await bedrock.send(new InvokeModelCommand(commandInput));
    const decoded =
      response.body === undefined
        ? null
        : new TextDecoder().decode(response.body);
    let parsed: unknown = null;
    if (decoded !== null && decoded.length > 0) {
      try {
        parsed = JSON.parse(decoded);
      } catch {
        parsed = null;
      }
    }

    const intervention = detectGuardrailIntervention(parsed);
    const tokens = extractInputOutputTokens(opts.model, parsed);

    return {
      ...base,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      guardrailIntervention: intervention,
      status: intervention ? "guardrailBlocked" : "success",
      errorCode: null,
      errorMessage: null,
      latencyMs: Date.now() - started,
    };
  } catch (err: unknown) {
    return {
      ...base,
      status: "error",
      errorCode: extractErrorCode(err),
      errorMessage: extractErrorMessage(err),
      latencyMs: Date.now() - started,
    };
  }
};
