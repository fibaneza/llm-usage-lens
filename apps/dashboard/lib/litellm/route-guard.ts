import "server-only";

import type { Session } from "next-auth";

import { env } from "@/env";
import { jsonError } from "@/lib/api/respond";
import { hasAdminRole, hasGlobalRole } from "@/lib/auth/roles";

import { LiteLLMError } from "./client";
import { LiteLLMOperationRefused } from "./gateway";

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

// A LiteLLM failure as the route's response (spec "API routes", error codes):
// a refused operation is 403 with its own code, any LiteLLM failure is 503
// LITELLM_UNAVAILABLE with fixed text. `null` for anything else (rethrow).
export function liteLLMErrorResponse(error: unknown): Response | null {
  if (error instanceof LiteLLMOperationRefused) {
    return jsonError(403, error.code, error.message);
  }
  if (error instanceof LiteLLMError) {
    return jsonError(503, error.code, error.message);
  }
  return null;
}

// Admin or Auditor (the read side of every Settings → LiteLLM route).
export function adminOrAuditorRefusal(
  session: Session | null,
): Response | null {
  return hasAdminRole(session) || hasGlobalRole(session, "internal-auditor")
    ? null
    : jsonError(403, "FORBIDDEN", "Admin or Auditor role required");
}
