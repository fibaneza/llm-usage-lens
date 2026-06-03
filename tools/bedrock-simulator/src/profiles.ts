import { z } from "zod";

export const ServiceKey = z.enum(["chat", "summarizer", "translator"]);
export type ServiceKey = z.infer<typeof ServiceKey>;

const SERVICE_ENV_VAR: Record<ServiceKey, string> = {
  chat: "INFERENCE_PROFILE_CHAT_ARN",
  summarizer: "INFERENCE_PROFILE_SUMMARIZER_ARN",
  translator: "INFERENCE_PROFILE_TRANSLATOR_ARN",
};

export const getInferenceProfileArn = (key: ServiceKey): string => {
  const envVar = SERVICE_ENV_VAR[key];
  const value = process.env[envVar];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${envVar} for service "${key}". ` +
        `The SAM template's SimulatorLambda Environment.Variables block must set it.`,
    );
  }
  return value;
};

export const SERVICE_KEYS: readonly ServiceKey[] = [
  "chat",
  "summarizer",
  "translator",
] as const;

export const UserKey = z.enum(["engineering", "research", "marketing"]);
export type UserKey = z.infer<typeof UserKey>;

const USER_ENV_VAR: Record<UserKey, string> = {
  engineering: "SIM_USER_ROLE_ENGINEERING_ARN",
  research: "SIM_USER_ROLE_RESEARCH_ARN",
  marketing: "SIM_USER_ROLE_MARKETING_ARN",
};

export const getSimUserRoleArn = (key: UserKey): string => {
  const envVar = USER_ENV_VAR[key];
  const value = process.env[envVar];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${envVar} for user "${key}". ` +
        `The SAM template's SimulatorLambda Environment.Variables block must set it.`,
    );
  }
  return value;
};

export const USER_KEYS: readonly UserKey[] = [
  "engineering",
  "research",
  "marketing",
] as const;
