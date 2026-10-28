"use client";

import { DepartmentsResponseSchema } from "@bedrock-usage/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useDepartments(params: Record<string, string>) {
  return useQuery({
    queryKey: ["departments", params],
    queryFn: () =>
      fetchApi(
        `/api/departments?${new URLSearchParams(params).toString()}`,
        DepartmentsResponseSchema,
      ),
  });
}
