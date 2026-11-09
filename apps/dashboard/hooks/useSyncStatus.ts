"use client";

import { SyncStatusResultSchema } from "@llm-usage-lens/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

// Design System — Caching Strategy: SyncStatus is cached for 5 minutes, so the
// shared header/overview query refreshes on that cadence (also when overdue).
const SYNC_STATUS_REFRESH_MS = 300_000;

export function useSyncStatus() {
  return useQuery({
    queryKey: ["sync-status"],
    queryFn: () => fetchApi("/api/sync-status", SyncStatusResultSchema),
    staleTime: SYNC_STATUS_REFRESH_MS,
    refetchInterval: SYNC_STATUS_REFRESH_MS,
  });
}
