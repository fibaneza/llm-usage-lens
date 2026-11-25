import "server-only";

import { trace } from "@opentelemetry/api";

import { env } from "@/env";

import { LiteLLMError, isLiteLLMConfigured } from "./client";
import { getUser } from "./operations";
import { enabledOperations } from "./read-views";

// Design System - LiteLLM user page (unit LP2), T-LP8: an unknown user id is
// the missing page. Uses the existing getUser read (no new operation); only a
// LiteLLM 404 means "unknown". Where no call may be made (open access mode,
// LT11; LiteLLM not configured, LD37; getUser off, LD19) or LiteLLM fails
// otherwise, the page stays up so its panels show their own states.
export async function proxyUserExists(litellmUserId: string): Promise<boolean> {
  if (env.AUTH_ACCESS_MODE === "open") return true;
  if (!(await isLiteLLMConfigured())) return true;
  if (!(await enabledOperations()).includes("getUser")) return true;
  try {
    await getUser({ litellmUserId });
    return true;
  } catch (error) {
    if (error instanceof LiteLLMError && error.status === 404) return false;
    // Span event without the raw error: it may carry upstream text (Rule 50.6).
    trace.getActiveSpan()?.addEvent("litellm.proxy_user_exists.failed", {
      "litellm.error.kind":
        error instanceof LiteLLMError ? error.detail : "unexpected",
    });
    return true;
  }
}
