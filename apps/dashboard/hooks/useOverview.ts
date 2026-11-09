"use client";

import { OverviewResponseSchema } from "@llm-usage-lens/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useOverview(params: Record<string, string>) {
  return useQuery({
    queryKey: ["overview", params],
    queryFn: () =>
      fetchApi(
        `/api/overview?${new URLSearchParams(params).toString()}`,
        OverviewResponseSchema,
      ),
  });
}
