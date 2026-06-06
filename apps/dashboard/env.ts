import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Type-safe environment variables (Rule 50.2 — never read process.env directly).
// Variable set defined in docs/specs/2026-05-15-implementation-phases.md
// §Required Environment Variables. SKIP_ENV_VALIDATION lets `next build` and
// lint run without secrets present (e.g. CI, ephemeral containers); real
// deployments leave it unset so missing vars fail the build.
export const env = createEnv({
  server: {
    AUTH_SECRET: z.string().min(1),
    AUTH_URL: z.url().optional(),
    AUTH_MICROSOFT_ENTRA_ID_ID: z.string().min(1),
    AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().min(1),
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: z.url(),
    AWS_REGION: z.string().default("us-east-1"),
    AWS_PROFILE: z.string().optional(),
    DYNAMODB_TABLE_NAME: z.string().default("bedrock-usage"),
    DYNAMODB_ENDPOINT: z.url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_SERVICE_NAME: z.string().default("bedrock-cost-dashboard"),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
