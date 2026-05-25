import { z } from "zod";

export const CanonicalModelKey = z.enum([
  "claude-opus",
  "claude-sonnet",
  "claude-haiku",
  "other",
]);
export type CanonicalModelKey = z.infer<typeof CanonicalModelKey>;

const MODEL_ENV_VAR: Record<CanonicalModelKey, string> = {
  "claude-opus": "CLAUDE_OPUS_INVOKE_ID",
  "claude-sonnet": "CLAUDE_SONNET_INVOKE_ID",
  "claude-haiku": "CLAUDE_HAIKU_INVOKE_ID",
  other: "OTHER_INVOKE_ID",
};

export const getInvokeId = (key: CanonicalModelKey): string => {
  const envVar = MODEL_ENV_VAR[key];
  const value = process.env[envVar];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${envVar} for canonical model "${key}". ` +
        `The SAM template's SimulatorLambda Environment.Variables block must set it.`,
    );
  }
  return value;
};

export const MODEL_KEYS: readonly CanonicalModelKey[] = [
  "claude-opus",
  "claude-sonnet",
  "claude-haiku",
  "other",
] as const;
