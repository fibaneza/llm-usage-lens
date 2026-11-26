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
//
// Unit LP3, T-LP13: also answers the display name for the breadcrumb - the
// trimmed user_alias, else the trimmed user_email, else null (null on every
// path that makes no call or fails).
export type ProxyUserLookup = { exists: boolean; name: string | null };

const trimmed = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

export async function proxyUserExists(
  litellmUserId: string,
): Promise<ProxyUserLookup> {
  const unknown = { exists: true, name: null };
  if (env.AUTH_ACCESS_MODE === "open") return unknown;
  if (!(await isLiteLLMConfigured())) return unknown;
  if (!(await enabledOperations()).includes("getUser")) return unknown;
  try {
    const info = await getUser({ litellmUserId });
    return {
      exists: true,
      name:
        trimmed(info.user_info?.user_alias) ??
        trimmed(info.user_info?.user_email),
    };
  } catch (error) {
    if (error instanceof LiteLLMError && error.status === 404) {
      return { exists: false, name: null };
    }
    // Span event without the raw error: it may carry upstream text (Rule 50.6).
    trace.getActiveSpan()?.addEvent("litellm.proxy_user_exists.failed", {
      "litellm.error.kind":
        error instanceof LiteLLMError ? error.detail : "unexpected",
    });
    return unknown;
  }
}
