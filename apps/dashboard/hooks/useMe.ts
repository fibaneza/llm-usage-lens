"use client";

import { MeResponseSchema } from "@llm-usage-lens/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => fetchApi("/api/me", MeResponseSchema),
    staleTime: 60_000,
  });
}
