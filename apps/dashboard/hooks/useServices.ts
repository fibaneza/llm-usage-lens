"use client";

import { ServicesResponseSchema } from "@bedrock-usage/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useServices(params: Record<string, string>) {
  return useQuery({
    queryKey: ["services", params],
    queryFn: () =>
      fetchApi(
        `/api/services?${new URLSearchParams(params).toString()}`,
        ServicesResponseSchema,
      ),
  });
}
