"use client";

import { LiteLLMUserDetailResponseSchema } from "@llm-usage-lens/shared";

import {
  useLiteLLMQuery,
  useLiteLLMQueryState,
  useUrlRange,
} from "@/components/litellm/use-litellm-query";

// LiteLLM spec - API routes, GET /api/litellm/users/[litellmUserId] (needs the
// URL range). The one read of the LiteLLM user page; every panel shares it.
function userRead(
  litellmUserId: string,
  keyParts: readonly string[],
  query: string,
) {
  return {
    key: ["proxy-user", litellmUserId, ...keyParts],
    path: `/api/litellm/users/${encodeURIComponent(litellmUserId)}?${query}`,
  };
}

export function useProxyUser(litellmUserId: string) {
  const { keyParts, query } = useUrlRange();
  const { key, path } = userRead(litellmUserId, keyParts, query);
  return useLiteLLMQuery(key, path, LiteLLMUserDetailResponseSchema);
}

// The same cache entry without suspending: a panel that is absent for some
// answers (Daily spend under the cap) decides outside its own boundary.
export function useProxyUserState(litellmUserId: string) {
  const { keyParts, query } = useUrlRange();
  const { key, path } = userRead(litellmUserId, keyParts, query);
  return useLiteLLMQueryState(key, path, LiteLLMUserDetailResponseSchema);
}
