import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { COLLECTOR_REGION } from "@llm-usage-lens/shared";

import {
  AuthConfigError,
  ENTRA_TENANT_ISSUER_MESSAGE,
  ENTRA_TENANT_ISSUER_PATTERN,
  LOCAL_AUTH_SECRET_PLACEHOLDER,
  resolveAccessMode,
  resolveSignInProviders,
} from "@/lib/auth/auth-config";

// Type-safe environment variables (Rule 50.2 — never read process.env directly).
// Variable set defined in docs/specs/2026-05-15-implementation-phases.md
// §Required Environment Variables. SKIP_ENV_VALIDATION lets tests and the e2e
// dev server run without secrets; builds (including `pnpm build:ci`, which
// uses non-secret placeholders) validate, so missing vars fail the build.
// Entra ID is optional; sign-in provider rules are cross-checked by
// resolveSignInProviders.
export const env = createEnv({
  server: {
    AUTH_SECRET: z.string().min(1),
    AUTH_URL: z.url().optional(),
    AUTH_MICROSOFT_ENTRA_ID_ID: z.string().min(1).optional(),
    AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().min(1).optional(),
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: z
      .string()
      .regex(ENTRA_TENANT_ISSUER_PATTERN, ENTRA_TENANT_ISSUER_MESSAGE)
      .optional(),
    AUTH_DEV_LOGIN: z.string().optional(),
    APP_ENV: z.enum(["dev", "prod"]),
    AUTH_ACCESS_MODE: z.string().optional(),
    AUTH_MASTER_USERNAME: z.string().min(1).optional(),
    AUTH_MASTER_PASSWORD_HASH: z.string().min(1).optional(),
    AUTH_MASTER_TOTP_SECRET: z
      .string()
      .min(16)
      .regex(/^[A-Z2-7]+=*$/)
      .optional(),
    TOTP_KMS_KEY_ID: z.string().min(1).optional(),
    AUDIT_LOG_GROUP_NAME: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).optional(),
    NEXT_PHASE: z.string().optional(),
    AWS_REGION: z.string().default(COLLECTOR_REGION),
    AWS_PROFILE: z.string().optional(),
    DYNAMODB_TABLE_NAME: z.string().default("bedrock-usage"),
    DYNAMODB_ENDPOINT: z.url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_SERVICE_NAME: z.string().default("llm-usage-lens"),
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
          if (
            value.AUTH_SECRET === LOCAL_AUTH_SECRET_PLACEHOLDER &&
            (value.APP_ENV === "prod" || value.NODE_ENV === "production")
          ) {
            ctx.addIssue({
              code: "custom",
              message:
                "AUTH_SECRET is the .env.example placeholder: generate a real secret outside local development.",
            });
          }
          if (value.APP_ENV === "prod" && !value.TOTP_KMS_KEY_ID) {
            ctx.addIssue({
              code: "custom",
              path: ["TOTP_KMS_KEY_ID"],
              message: "TOTP_KMS_KEY_ID is required when APP_ENV=prod.",
            });
          }
          try {
            resolveSignInProviders({
              nodeEnv: value.NODE_ENV,
              entraId: value.AUTH_MICROSOFT_ENTRA_ID_ID,
              entraSecret: value.AUTH_MICROSOFT_ENTRA_ID_SECRET,
              entraIssuer: value.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
              devLogin: value.AUTH_DEV_LOGIN,
              appEnv: value.APP_ENV,
              masterUsername: value.AUTH_MASTER_USERNAME,
              masterPasswordHash: value.AUTH_MASTER_PASSWORD_HASH,
              masterTotpSecret: value.AUTH_MASTER_TOTP_SECRET,
            });
            resolveAccessMode(value.AUTH_ACCESS_MODE, value.APP_ENV);
          } catch (error) {
            if (!(error instanceof AuthConfigError)) throw error;
            ctx.addIssue({ code: "custom", message: error.message });
          }
        })
      : z.object(shape),
  // Names the failing variables (never their values) so a misconfigured deploy
  // is diagnosable from the thrown error alone.
  onValidationError: (issues) => {
    const names = issues.map((i) => i.path?.join(".") || i.message);
    throw new Error(`Invalid environment variables: ${names.join(", ")}`);
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
