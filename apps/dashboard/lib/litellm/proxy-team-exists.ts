import "server-only";

import { trace } from "@opentelemetry/api";

import { env } from "@/env";

import { LiteLLMError, isLiteLLMConfigured } from "./client";
import { getTeam } from "./operations";
import { enabledOperations } from "./read-views";

// Design System - LiteLLM team page (unit LP1), T-LP4: an unknown team id is
// the missing page. Uses the existing getTeam read (no new operation); only a
// LiteLLM 404 means "unknown". Where no call may be made (open access mode,
// LT11; LiteLLM not configured, LD37; getTeam off, LD19) or LiteLLM fails
// otherwise, the page stays up so its panels show their own states.
export async function proxyTeamExists(litellmTeamId: string): Promise<boolean> {
  if (env.AUTH_ACCESS_MODE === "open") return true;
  if (!(await isLiteLLMConfigured())) return true;
  if (!(await enabledOperations()).includes("getTeam")) return true;
  try {
    await getTeam({ litellmTeamId });
    return true;
  } catch (error) {
    if (error instanceof LiteLLMError && error.status === 404) return false;
    // Span event without the raw error: it may carry upstream text (Rule 50.6).
    trace.getActiveSpan()?.addEvent("litellm.proxy_team_exists.failed", {
      "litellm.error.kind":
        error instanceof LiteLLMError ? error.detail : "unexpected",
    });
    return true;
  }
}
