"use client";

import { UsersResponseSchema } from "@bedrock-usage/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useUsers(params: Record<string, string>) {
  return useQuery({
    queryKey: ["users", params],
    queryFn: () =>
      fetchApi(
        `/api/users?${new URLSearchParams(params).toString()}`,
        UsersResponseSchema,
      ),
  });
}
