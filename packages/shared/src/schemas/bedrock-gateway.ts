import { z } from "zod";

import { canonicalUsageIdentity } from "../usage-identity";

import { AccountIdSchema, Iso8601Schema } from "./primitives";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6) -> Gateway configuration" (Schema, Validation, Route), LD38, LT29.
// Named BedrockGatewayConfig because LiteLLMGatewayConfig already names the
// config.yaml operations branch (LD19).

// eslint-disable-next-line no-control-regex -- the point is to refuse C0 and DEL
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const IAM_ROLE_NAME = /^[\w+=,.@-]{1,64}$/;

// A person key as a principal would hide real usage (LT29).
const notPerson = (value: string) =>
  canonicalUsageIdentity(value).kind !== "person";

const IamRolePrincipalSchema = z.strictObject({
  type: z.literal("iam-role"),
  value: z.string().trim().regex(IAM_ROLE_NAME).refine(notPerson),
});
const UsageKeyPrincipalSchema = z.strictObject({
  type: z.literal("usage-key"),
  value: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .refine((v) => !CONTROL_CHARS.test(v))
    .refine(notPerson),
});
export const GatewayPrincipalSchema = z.discriminatedUnion("type", [
  IamRolePrincipalSchema,
  UsageKeyPrincipalSchema,
]);

const PrincipalsSchema = z.array(GatewayPrincipalSchema).max(20);
const AccountIdsSchema = z
  .array(AccountIdSchema)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Duplicate account ids",
  });

const noDuplicatePrincipals = (
  principals: z.infer<typeof PrincipalsSchema>,
): boolean => {
  const seen = new Set<string>();
  for (const p of principals) {
    const id = `${p.type}:${p.type === "iam-role" ? p.value.toLowerCase() : p.value}`;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
};

export const BedrockGatewayConfigSchema = z.strictObject({
  principals: PrincipalsSchema,
  accountIds: AccountIdsSchema,
  version: z.number().int().min(1),
  updatedAt: Iso8601Schema,
  updatedBy: z.string().min(1),
});
export type BedrockGatewayConfig = z.infer<typeof BedrockGatewayConfigSchema>;

export const BedrockGatewayPutSchema = z
  .strictObject({
    version: z.number().int().min(1).nullable(),
    principals: PrincipalsSchema,
    accountIds: AccountIdsSchema,
  })
  .refine((v) => noDuplicatePrincipals(v.principals), {
    message: "Duplicate principals",
    path: ["principals"],
  });
export type BedrockGatewayPut = z.infer<typeof BedrockGatewayPutSchema>;

export const BedrockGatewayViewSchema = z.strictObject({
  gatewayConfigured: z.boolean(),
  version: z.number().int().min(0),
  principals: PrincipalsSchema,
  accountIds: AccountIdsSchema,
  updatedAt: Iso8601Schema.optional(),
  updatedBy: z.string().min(1).optional(),
});
export type BedrockGatewayView = z.infer<typeof BedrockGatewayViewSchema>;
