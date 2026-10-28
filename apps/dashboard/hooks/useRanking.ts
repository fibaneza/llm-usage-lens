"use client";

import { RankingResponseSchema } from "@bedrock-usage/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useRanking(params: Record<string, string>) {
  return useQuery({
    queryKey: ["ranking", params],
    queryFn: () =>
      fetchApi(
        `/api/ranking?${new URLSearchParams(params).toString()}`,
        RankingResponseSchema,
      ),
  });
}
