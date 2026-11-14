import "server-only";

import { env } from "@/env";
import { jsonError } from "@/lib/api/respond";

// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" item 11
// (threat LT11): with AUTH_ACCESS_MODE=open there is no real identity to
// audit, so every LiteLLM route answers 403 OPERATION_UNAVAILABLE after the
// session check.
export function openModeRefusal(): Response | null {
  return env.AUTH_ACCESS_MODE === "open"
    ? jsonError(
        403,
        "OPERATION_UNAVAILABLE",
        "LiteLLM administration is unavailable in open access mode",
      )
    : null;
}
