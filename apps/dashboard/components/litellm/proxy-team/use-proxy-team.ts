"use client";

import { LiteLLMProxyTeamResponseSchema } from "@llm-usage-lens/shared";

import {
  useLiteLLMQuery,
  useLiteLLMQueryState,
} from "@/components/litellm/use-litellm-query";

// LiteLLM spec - API routes, GET /api/litellm/proxy-teams/[litellmTeamId]. The
// one read of the LiteLLM team page; the summary and link panels share it.
export function useProxyTeam(litellmTeamId: string) {
  return useLiteLLMQuery(
    ["proxy-team", litellmTeamId],
    `/api/litellm/proxy-teams/${encodeURIComponent(litellmTeamId)}`,
    LiteLLMProxyTeamResponseSchema,
  );
}

// The same cache entry without suspending: the Members panel reads only the
// alias and must not fail with the team read (Rule 40.4).
export function useProxyTeamState(litellmTeamId: string) {
  return useLiteLLMQueryState(
    ["proxy-team", litellmTeamId],
    `/api/litellm/proxy-teams/${encodeURIComponent(litellmTeamId)}`,
    LiteLLMProxyTeamResponseSchema,
  );
}
