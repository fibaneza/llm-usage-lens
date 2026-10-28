"use client";

import { TeamDetailResponseSchema } from "@bedrock-usage/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useTeam(id: string, params: Record<string, string>) {
  return useQuery({
    queryKey: ["team", id, params],
    queryFn: () =>
      fetchApi(
        `/api/teams/${encodeURIComponent(id)}?${new URLSearchParams(params).toString()}`,
        TeamDetailResponseSchema,
      ),
  });
}
