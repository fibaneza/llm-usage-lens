"use client";

import { LiteLLMTeamDetailResponseSchema } from "@llm-usage-lens/shared";
import { useLiteLLMQuery } from "./use-litellm-query";

export function useTeamDetail(teamId: string) {
  return useLiteLLMQuery(
    ["team", teamId],
    `/api/litellm/teams/${encodeURIComponent(teamId)}`,
    LiteLLMTeamDetailResponseSchema,
  );
}
