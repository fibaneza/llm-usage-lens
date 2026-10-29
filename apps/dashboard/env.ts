import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import {
  AuthConfigError,
  resolveSignInProviders,
} from "@/lib/auth/auth-config";

// Type-safe environment variables (Rule 50.2 — never read process.env directly).
// Variable set defined in docs/specs/2026-05-15-implementation-phases.md
// §Required Environment Variables. SKIP_ENV_VALIDATION lets `next build` and
// lint run without secrets present (e.g. CI, ephemeral containers); real
// deployments leave it unset so missing vars fail the build. Entra ID is
// optional; sign-in provider rules are cross-checked by resolveSignInProviders.
export const env = createEnv({
  server: {
    AUTH_SECRET: z.string().min(1),
    AUTH_URL: z.url().optional(),
    AUTH_MICROSOFT_ENTRA_ID_ID: z.string().min(1).optional(),
    AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().min(1).optional(),
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: z.url().optional(),
    AUTH_DEV_LOGIN: z.string().optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).optional(),
    NEXT_PHASE: z.string().optional(),
    AWS_REGION: z.string().default("us-east-1"),
    AWS_PROFILE: z.string().optional(),
    DYNAMODB_TABLE_NAME: z.string().default("bedrock-usage"),
    DYNAMODB_ENDPOINT: z.url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_SERVICE_NAME: z.string().default("bedrock-cost-dashboard"),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
    // Organization name shown in the top bar (design-system spec — Layout).
    NEXT_PUBLIC_ORG_NAME: z.string().min(1).default("Organization"),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ORG_NAME: process.env.NEXT_PUBLIC_ORG_NAME,
  },
  // Server vars are absent in the browser bundle, so cross-check server-side only.
  createFinalSchema: (shape, isServer) =>
    isServer
      ? z.object(shape).superRefine((value, ctx) => {
          try {
            resolveSignInProviders({
              nodeEnv: value.NODE_ENV,
              entraId: value.AUTH_MICROSOFT_ENTRA_ID_ID,
              entraSecret: value.AUTH_MICROSOFT_ENTRA_ID_SECRET,
              entraIssuer: value.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
              devLogin: value.AUTH_DEV_LOGIN,
            });
          } catch (error) {
            if (!(error instanceof AuthConfigError)) throw error;
            ctx.addIssue({ code: "custom", message: error.message });
          }
        })
      : z.object(shape),
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
