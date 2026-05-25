import { z } from "zod";

import { invokeOnce, type InvocationResult } from "./invoke.js";
import {
  CanonicalModelKey,
  MODEL_KEYS,
  type CanonicalModelKey as CanonicalModelKeyT,
} from "./models.js";
import {
  ServiceKey,
  SERVICE_KEYS,
  UserKey,
  USER_KEYS,
  type ServiceKey as ServiceKeyT,
  type UserKey as UserKeyT,
} from "./profiles.js";
import { pickPromptForService } from "./prompts.js";

const TOTAL_CALLS_HARD_CAP = 50;

const MAX_TOKENS_SMOKE = 200;
const MAX_TOKENS_DEFAULT = 1000;
// Heavy is selectable only by an internal code change; never by input.
const MAX_TOKENS_HEAVY = 2000;
// Set this constant to "heavy" only behind a code review when running a
// heavy-Opus run-cost test. See spec — "Prompt and token caps".
const INTERNAL_PROFILE_OVERRIDE: "default" | "heavy" | null = null;

export const InvocationPayloadSchema = z
  .object({
    totalCalls: z
      .number()
      .int()
      .min(1, "totalCalls must be at least 1")
      .max(
        TOTAL_CALLS_HARD_CAP,
        `totalCalls is hard-capped at ${TOTAL_CALLS_HARD_CAP}`,
      ),
    models: z
      .array(CanonicalModelKey)
      .min(1, "models must contain at least one model"),
    services: z
      .array(ServiceKey)
      .min(1, "services must contain at least one service"),
    users: z.array(UserKey).min(1, "users must contain at least one user"),
    guardrailRatio: z
      .number()
      .min(0, "guardrailRatio must be >= 0")
      .max(1, "guardrailRatio must be <= 1"),
  })
  .strict();

export type InvocationPayload = z.infer<typeof InvocationPayloadSchema>;

const InvocationResultSchema = z.object({
  user: UserKey,
  service: ServiceKey,
  model: CanonicalModelKey,
  status: z.enum(["success", "error", "guardrailBlocked"]),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  guardrailIntervention: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  latencyMs: z.number().int().nonnegative(),
});

const HandlerResponseSchema = z.object({
  results: z.array(InvocationResultSchema),
  summary: z.object({
    totalCalls: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    errored: z.number().int().nonnegative(),
    guardrailBlocked: z.number().int().nonnegative(),
  }),
});

export type HandlerResponse = z.infer<typeof HandlerResponseSchema>;

const pickRandom = <T,>(arr: readonly T[], rng: () => number): T => {
  if (arr.length === 0) {
    throw new Error("Cannot pick from an empty array.");
  }
  const index = Math.floor(rng() * arr.length) % arr.length;
  const value = arr[index];
  if (value === undefined) {
    throw new Error("Internal: random pick yielded undefined.");
  }
  return value;
};

const resolveMaxTokens = (totalCalls: number): number => {
  if (totalCalls === 1) return MAX_TOKENS_SMOKE;
  if (INTERNAL_PROFILE_OVERRIDE === "heavy") return MAX_TOKENS_HEAVY;
  return MAX_TOKENS_DEFAULT;
};

const summarise = (
  results: readonly InvocationResult[],
): HandlerResponse["summary"] => {
  let success = 0;
  let errored = 0;
  let guardrailBlocked = 0;
  for (const r of results) {
    if (r.status === "success") success += 1;
    else if (r.status === "guardrailBlocked") guardrailBlocked += 1;
    else errored += 1;
  }
  return {
    totalCalls: results.length,
    success,
    errored,
    guardrailBlocked,
  };
};

export type HandlerDeps = {
  rng?: (() => number) | undefined;
  invoke?: typeof invokeOnce | undefined;
  region?: string | undefined;
  guardrailId?: string | undefined;
  guardrailVersion?: string | undefined;
};

export const runHandler = async (
  rawEvent: unknown,
  deps: HandlerDeps = {},
): Promise<HandlerResponse> => {
  const payload = InvocationPayloadSchema.parse(rawEvent);
  const rng = deps.rng ?? Math.random;
  const invoke = deps.invoke ?? invokeOnce;
  const region = deps.region ?? process.env["AWS_REGION"] ?? "us-east-1";
  const guardrailId = deps.guardrailId ?? process.env["GUARDRAIL_ID"];
  const guardrailVersion =
    deps.guardrailVersion ?? process.env["GUARDRAIL_VERSION"];

  // Restrict the payload-supplied dimensions to known keys (defence in depth;
  // Zod already enforces this at parse time).
  const models = payload.models.filter((m): m is CanonicalModelKeyT =>
    MODEL_KEYS.includes(m),
  );
  const services = payload.services.filter((s): s is ServiceKeyT =>
    SERVICE_KEYS.includes(s),
  );
  const users = payload.users.filter((u): u is UserKeyT =>
    USER_KEYS.includes(u),
  );

  if (models.length === 0 || services.length === 0 || users.length === 0) {
    throw new Error(
      "After filtering, at least one of models/services/users is empty.",
    );
  }

  const maxTokens = resolveMaxTokens(payload.totalCalls);
  const results: InvocationResult[] = [];

  for (let i = 0; i < payload.totalCalls; i += 1) {
    const user = pickRandom(users, rng);
    const service = pickRandom(services, rng);
    const model = pickRandom(models, rng);
    const useGuardrail = rng() < payload.guardrailRatio;
    const prompt = pickPromptForService(service, rng);

    const result = await invoke({
      user,
      service,
      model,
      prompt,
      maxTokens,
      useGuardrail,
      guardrailId,
      guardrailVersion,
      region,
    });
    results.push(result);
  }

  const response: HandlerResponse = {
    results,
    summary: summarise(results),
  };
  return HandlerResponseSchema.parse(response);
};

export const handler = async (event: unknown): Promise<HandlerResponse> =>
  runHandler(event);
