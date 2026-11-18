"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MarkNotificationsReadResponseSchema,
  NotificationListResponseSchema,
} from "@llm-usage-lens/shared";

import { fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: docs/specs/2026-11-10-litellm.md — MG-D13 (the bell polls every 60 s
// and pauses while the tab is hidden); Design System — Caching Strategy
// (nothing in browser storage); Rule 60.10 (never cached server-side).
export const NOTIFICATIONS_KEY = ["notifications"] as const;
const POLL_MS = 60_000;

export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () =>
      fetchApi("/api/notifications", NotificationListResponseSchema),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
}

type MarkReadBody = { ids: string[] } | { all: true };

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MarkReadBody) =>
      mutateApi(
        "/api/notifications/read",
        "POST",
        body,
        MarkNotificationsReadResponseSchema,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}
