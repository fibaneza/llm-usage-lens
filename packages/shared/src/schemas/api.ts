import { z } from "zod";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes" (standard
// response shape); Rule 20.11, Rule 10.4.

export const API_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "BAD_REQUEST",
  "NOT_FOUND",
  "INTERNAL",
  "LITELLM_UNAVAILABLE",
  "OPERATION_UNAVAILABLE",
  "OPERATION_DISABLED",
  "PRIVILEGED_TARGET",
  "CONFLICT",
  "MANAGED_BY_SSO",
  "ALREADY_AFFILIATED",
  "REAUTH_REQUIRED",
  "SSO_BOUND",
  "WEAK_PASSWORD",
] as const;

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorBodySchema = z.object({
  error: z.object({ code: z.string().min(1), message: z.string() }),
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export function apiSuccessSchema<T extends z.ZodType>(data: T) {
  return z.object({ data });
}

export function apiResponseSchema<T extends z.ZodType>(data: T) {
  return z.union([apiSuccessSchema(data), ApiErrorBodySchema]);
}
