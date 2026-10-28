"use client";

import { TeamsResponseSchema } from "@bedrock-usage/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useTeams(params: Record<string, string>) {
  return useQuery({
    queryKey: ["teams", params],
    queryFn: () =>
      fetchApi(
        `/api/teams?${new URLSearchParams(params).toString()}`,
        TeamsResponseSchema,
      ),
  });
}
