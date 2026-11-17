import "server-only";

import type { LiteLLMGatewayConfig } from "@llm-usage-lens/shared";

import { getAppConfig } from "@/lib/config/app-config";

// Source: docs/specs/2026-11-10-litellm.md — "Guardrail configuration" (LD19)
// and System Architecture — "Configuration file" (A8): the gateway config is
// the `litellm` branch of config/config.yaml, validated with the whole file
// when the server starts. Configuration can only narrow what the allowlist
// already permits.
export function loadGatewayConfig(): LiteLLMGatewayConfig {
  return getAppConfig().litellm ?? { operations: {} };
}
