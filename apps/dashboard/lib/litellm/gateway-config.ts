import "server-only";

import { LiteLLMGatewayConfigSchema } from "@llm-usage-lens/shared";
import type { LiteLLMGatewayConfig } from "@llm-usage-lens/shared";

import raw from "@/config/litellm-gateway.json";

// Source: docs/specs/2026-11-10-litellm.md — "Guardrail configuration" (LD19)
// and Rule 60.19: the checked-in config file holds only per-operation
// `enabled` defaults and `wildcardWarning`. It is parsed when this module
// first loads (server start); an unknown operation, an unknown field or an
// invalid value throws and the server does not start. Configuration can only
// narrow what the allowlist already permits.
const config: LiteLLMGatewayConfig = LiteLLMGatewayConfigSchema.parse(raw);

export function loadGatewayConfig(): LiteLLMGatewayConfig {
  return config;
}
