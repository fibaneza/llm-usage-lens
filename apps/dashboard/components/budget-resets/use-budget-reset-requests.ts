"use client";

import {
  BudgetResetRequestListResponseSchema,
  BudgetResetRequestViewSchema,
  MyBudgetResetRequestsSchema,
} from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: docs/specs/2026-11-10-litellm.md -- "Budget reset requests". No
// polling here: the notification bell polls (M4 design, A3).
export function useMyBudgetResetRequests() {
  return useQuery({
    queryKey: ["budget-reset-requests", "mine"],
    queryFn: () =>
      fetchApi("/api/budget-reset-requests/mine", MyBudgetResetRequestsSchema),
  });
}

export function useTeamBudgetResetRequests(teamId: string) {
  return useQuery({
    queryKey: ["budget-reset-requests", "team", teamId],
    queryFn: () =>
      fetchApi(
        `/api/budget-reset-requests?teamId=${encodeURIComponent(teamId)}&status=open`,
        BudgetResetRequestListResponseSchema,
      ),
    retry: false,
  });
}

export function useCreateBudgetResetRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string | undefined) =>
      mutateApi(
        "/api/budget-reset-requests",
        "POST",
        reason === undefined ? {} : { reason },
        BudgetResetRequestViewSchema,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["budget-reset-requests"] }),
  });
}
