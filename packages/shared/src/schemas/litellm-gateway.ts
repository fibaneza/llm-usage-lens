import { z } from "zod";

import { LITELLM_EDITIONS } from "./litellm";
import { Iso8601Schema } from "./primitives";

// Source: docs/specs/2026-11-10-litellm.md — "Allowlist (the gateway)" (the
// operation names), "Guardrail configuration" (LD19: the config file holds
// only per-operation `enabled: false` defaults; configuration can only
// narrow), "Data model additions" (OperationToggles, TeamLink; every
// item versioned); Rule 60.19.
export const LITELLM_OPERATION_NAMES = [
  "getTeam",
  "listProxyTeams",
  "getTeamDailySpend",
  "getUser",
  "findUserByEmail",
  "getUserDailySpend",
  "listKeys",
  "getKey",
  "listSpendLogs",
  "listProxyModels",
  "listProxyAuditLog",
  "getGlobalSpendReport",
  "createTeam",
  "setTeamBudget",
  "setTeamLimits",
  "setTeamModels",
  "addTeamMember",
  "removeTeamMember",
  "setMemberBudget",
  "setMemberLimits",
  "resetMemberSpend",
  "resetMemberBudget",
  "disableMember",
  "enableMember",
  "generateMemberKey",
  "updateMemberKey",
  "blockKey",
  "unblockKey",
  "deleteKey",
  "rotateKey",
] as const;

export const LiteLLMOperationNameSchema = z.enum(LITELLM_OPERATION_NAMES);
export type LiteLLMOperationName = z.infer<typeof LiteLLMOperationNameSchema>;

// Keyed by allowlisted operation name only; nothing here can name a route, a
// body field or widen (an unknown key or field fails startup).
export const LiteLLMGatewayConfigSchema = z.strictObject({
  operations: z.partialRecord(
    LiteLLMOperationNameSchema,
    z.strictObject({ enabled: z.literal(false) }),
  ),
});
export type LiteLLMGatewayConfig = z.infer<typeof LiteLLMGatewayConfigSchema>;

// Saved values (UI layer). Names are validated on write; reads tolerate and
// ignore a stored name outside the allowlist (toggles never add an operation).
export const OperationTogglesSchema = z.strictObject({
  version: z.number().int().min(1),
  toggles: z.record(z.string(), z.boolean()),
  updatedAt: Iso8601Schema,
});
export type OperationToggles = z.infer<typeof OperationTogglesSchema>;

export const TeamLinkSchema = z.strictObject({
  teamId: z.string().min(1),
  litellmTeamId: z.string().min(1),
  version: z.number().int().min(1),
  updatedAt: Iso8601Schema,
});
export type TeamLink = z.infer<typeof TeamLinkSchema>;

// GET/PUT /api/litellm/toggles response: each operation's effective value and
// its source (ui | file | spec). Spec "Guardrail configuration" (LD19).
export const OperationTogglesViewSchema = z.object({
  version: z.number().int().min(0),
  edition: z.enum(LITELLM_EDITIONS),
  operations: z.record(
    z.string(),
    z.object({
      enabled: z.boolean(),
      source: z.enum(["ui", "file", "spec"]),
    }),
  ),
});
export type OperationTogglesView = z.infer<typeof OperationTogglesViewSchema>;
