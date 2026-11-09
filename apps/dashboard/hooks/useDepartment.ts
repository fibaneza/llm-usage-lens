"use client";

import { DepartmentDetailResponseSchema } from "@llm-usage-lens/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useDepartment(id: string, params: Record<string, string>) {
  return useQuery({
    queryKey: ["department", id, params],
    queryFn: () =>
      fetchApi(
        `/api/departments/${encodeURIComponent(id)}?${new URLSearchParams(params).toString()}`,
        DepartmentDetailResponseSchema,
      ),
  });
}
