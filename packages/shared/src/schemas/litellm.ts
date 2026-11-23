import { z } from "zod";

import { Iso8601Schema } from "./primitives";

// Source: docs/specs/2026-11-10-litellm.md — "Data model additions"
// (LiteLLMConnection holds the base URL only, versioned; the service key is
// never stored; edition is derived from APP_ENV, LD11) and "Security
// architecture" item 6 (connection test results).
export const LiteLLMConnectionSchema = z.strictObject({
  baseUrl: z.url(),
  version: z.number().int().min(1),
  updatedAt: Iso8601Schema,
});
export type LiteLLMConnection = z.infer<typeof LiteLLMConnectionSchema>;

export const LITELLM_EDITIONS = ["oss", "enterprise"] as const;

export function liteLLMEdition(appEnv: "dev" | "prod"): "oss" | "enterprise" {
  return appEnv === "prod" ? "enterprise" : "oss";
}

export const LiteLLMConnectionStatusSchema = z.strictObject({
  baseUrl: z.url().nullable(),
  version: z.number().int().min(0),
  edition: z.enum(LITELLM_EDITIONS),
  serviceKeyConfigured: z.boolean(),
  defaultBaseUrl: z.url().optional(),
});
export type LiteLLMConnectionStatus = z.infer<
  typeof LiteLLMConnectionStatusSchema
>;

export const ConnectionTestResultSchema = z.strictObject({
  result: z.enum([
    "ok",
    "unauthorised",
    "routes_out_of_date",
    "unreachable",
    "not_configured",
  ]),
  message: z.string(),
  // Gateway guardrails item 6: e.g. the temporary-wildcard notice.
  warnings: z.array(z.string()).default([]),
});
export type ConnectionTestResult = z.infer<typeof ConnectionTestResultSchema>;
