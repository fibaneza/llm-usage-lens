"use client";

import { MeUsageResponseSchema } from "@llm-usage-lens/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useMeUsage(params: { dateFrom: string; dateTo: string }) {
  return useQuery({
    queryKey: ["me-usage", params],
    queryFn: () =>
      fetchApi(
        `/api/me/usage?${new URLSearchParams(params).toString()}`,
        MeUsageResponseSchema,
      ),
  });
}
