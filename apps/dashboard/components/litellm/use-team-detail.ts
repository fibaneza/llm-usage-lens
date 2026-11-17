"use client";

import { LiteLLMTeamDetailResponseSchema } from "@llm-usage-lens/shared";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { z } from "zod";

import { ApiRequestError, fetchApi } from "@/lib/query/fetch-api";

import {
  useLiteLLMQuery,
  useLiteLLMQueryState,
  useUrlRange,
} from "./use-litellm-query";
import type { LiteLLMResult } from "./use-litellm-query";

export function useTeamDetail(teamId: string) {
  const { keyParts, query } = useUrlRange();
  return useLiteLLMQuery(
    ["team", teamId, ...keyParts],
    `/api/litellm/teams/${encodeURIComponent(teamId)}?${query}`,
    LiteLLMTeamDetailResponseSchema,
  );
}

// The same cache entry as useTeamDetail, without suspending: for the page
// chrome (the view tabs) that renders around a pending or failed read.
export function useTeamDetailState(teamId: string) {
  const { keyParts, query } = useUrlRange();
  return useLiteLLMQueryState(
    ["team", teamId, ...keyParts],
    `/api/litellm/teams/${encodeURIComponent(teamId)}?${query}`,
    LiteLLMTeamDetailResponseSchema,
  );
}

export type TeamSpendDetail =
  | LiteLLMResult<z.output<typeof LiteLLMTeamDetailResponseSchema>>
  | { status: "refused"; message: string };

// The Team page's spend section: the one read that asks for the member sum
// (App Teams spec - API changes, build details; the server ignores it for a
// Lead, ATT6). A team above the member cap answers 422, shown in the section
// (AT6), not thrown into its boundary.
export function useTeamSpendDetail(teamId: string) {
  const { keyParts, query } = useUrlRange();
  return useSuspenseQuery({
    queryKey: ["litellm", "team", teamId, ...keyParts, "memberSum"],
    queryFn: async (): Promise<TeamSpendDetail> => {
      try {
        return {
          status: "ok",
          data: await fetchApi(
            `/api/litellm/teams/${encodeURIComponent(teamId)}?${query}&include=memberSum`,
            LiteLLMTeamDetailResponseSchema,
          ),
        };
      } catch (error) {
        if (error instanceof ApiRequestError) {
          if (error.code === "LITELLM_UNAVAILABLE") {
            return { status: "unavailable" };
          }
          if (error.code === "TOO_MANY_MEMBERS") {
            return { status: "refused", message: error.message };
          }
        }
        throw error;
      }
    },
  }).data;
}
