"use client";

import { LiteLLMProxyTeamDailyResponseSchema } from "@llm-usage-lens/shared";

import {
  useLiteLLMQuery,
  useLiteLLMQueryState,
  useUrlRange,
} from "@/components/litellm/use-litellm-query";

// LiteLLM spec - API routes, GET /api/litellm/proxy-teams/[litellmTeamId]/daily
// (needs the URL range). The one read of the team page's Spend over time panel.
function dailyRead(
  litellmTeamId: string,
  keyParts: readonly string[],
  query: string,
) {
  return {
    key: ["proxy-team-daily", litellmTeamId, ...keyParts],
    path: `/api/litellm/proxy-teams/${encodeURIComponent(litellmTeamId)}/daily?${query}`,
  };
}

export function useProxyTeamDaily(litellmTeamId: string) {
  const { keyParts, query } = useUrlRange();
  const { key, path } = dailyRead(litellmTeamId, keyParts, query);
  return useLiteLLMQuery(key, path, LiteLLMProxyTeamDailyResponseSchema);
}

// The same cache entry without suspending (see ProxyTeamDailyPanel).
export function useProxyTeamDailyState(litellmTeamId: string) {
  const { keyParts, query } = useUrlRange();
  const { key, path } = dailyRead(litellmTeamId, keyParts, query);
  return useLiteLLMQueryState(key, path, LiteLLMProxyTeamDailyResponseSchema);
}
