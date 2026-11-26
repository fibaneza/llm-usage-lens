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
//
// Unit LP3, T-LP14: also answers the trimmed team_alias for the breadcrumb
// (null when absent, and on every path that makes no call or fails).
export type ProxyTeamLookup = { exists: boolean; name: string | null };

export async function proxyTeamExists(
  litellmTeamId: string,
): Promise<ProxyTeamLookup> {
  const unknown = { exists: true, name: null };
  if (env.AUTH_ACCESS_MODE === "open") return unknown;
  if (!(await isLiteLLMConfigured())) return unknown;
  if (!(await enabledOperations()).includes("getTeam")) return unknown;
  try {
    const info = await getTeam({ litellmTeamId });
    const alias = info.team_info.team_alias?.trim();
    return { exists: true, name: alias ? alias : null };
  } catch (error) {
    if (error instanceof LiteLLMError && error.status === 404) {
      return { exists: false, name: null };
    }
    // Span event without the raw error: it may carry upstream text (Rule 50.6).
    trace.getActiveSpan()?.addEvent("litellm.proxy_team_exists.failed", {
      "litellm.error.kind":
        error instanceof LiteLLMError ? error.detail : "unexpected",
    });
    return unknown;
  }
}
