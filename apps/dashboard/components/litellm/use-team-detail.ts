"use client";

import { LiteLLMTeamDetailResponseSchema } from "@llm-usage-lens/shared";
import { useLiteLLMQuery, useUrlRange } from "./use-litellm-query";

export function useTeamDetail(teamId: string) {
  const { keyParts, query } = useUrlRange();
  return useLiteLLMQuery(
    ["team", teamId, ...keyParts],
    `/api/litellm/teams/${encodeURIComponent(teamId)}?${query}`,
    LiteLLMTeamDetailResponseSchema,
  );
}
