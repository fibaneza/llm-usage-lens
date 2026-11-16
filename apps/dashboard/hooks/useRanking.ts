"use client";

import { RankingResponseSchema } from "@llm-usage-lens/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useRanking(params: Record<string, string>) {
  return useQuery({
    queryKey: ["ranking", params],
    // Keeps the table (and its Model filter) mounted while the next request is
    // pending so keyboard focus survives a filter or tab change.
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchApi(
        `/api/ranking?${new URLSearchParams(params).toString()}`,
        RankingResponseSchema,
      ),
  });
}
