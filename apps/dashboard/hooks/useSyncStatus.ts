"use client";

import { SyncStatusResultSchema } from "@bedrock-usage/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useSyncStatus() {
  return useQuery({
    queryKey: ["sync-status"],
    queryFn: () => fetchApi("/api/sync-status", SyncStatusResultSchema),
  });
}
