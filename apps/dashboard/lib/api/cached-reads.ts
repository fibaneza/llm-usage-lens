import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";

import {
  getAccountsByDepartment,
  getAllAccounts,
} from "@/lib/data/account-meta";
import { getSyncStatus } from "@/lib/data/sync-status";

const ONE_HOUR_SECONDS = 3600;
const FIVE_MINUTES_SECONDS = 300;

// Rule 60.10: Route Handler reads are cached for the hourly collector cycle.
// Auth runs in withRoute before these are called (Rule 50.4). Values are plain
// JSON (strings/numbers), so they survive the cache serialization boundary.
export const getAllAccountsCached = unstable_cache(
  getAllAccounts,
  ["accounts-all"],
  { revalidate: ONE_HOUR_SECONDS, tags: ["accounts"] },
);

export const getAccountsByDepartmentCached = unstable_cache(
  getAccountsByDepartment,
  ["accounts-by-department"],
  { revalidate: ONE_HOUR_SECONDS, tags: ["accounts"] },
);

// SyncCountdown reads nextScheduledAt; keep it fresher than the hourly cycle.
export const getSyncStatusCached = unstable_cache(
  getSyncStatus,
  ["sync-status"],
  { revalidate: FIVE_MINUTES_SECONDS, tags: ["sync-status"] },
);

let lastBypassAt = Number.NEGATIVE_INFINITY;

export const SYNC_STATUS_BYPASS_MIN_INTERVAL_MS = 10_000;

// Design System - Caching Strategy, Refresh (T-RF3, T-RF6): at most one expiry
// of the one fixed tag per interval; inside it the current entry is served
// without a DynamoDB read. Set before awaiting so concurrent callers share it.
export function refreshSyncStatusCached() {
  const now = Date.now();
  if (now - lastBypassAt >= SYNC_STATUS_BYPASS_MIN_INTERVAL_MS) {
    lastBypassAt = now;
    revalidateTag("sync-status", { expire: 0 });
  }
  return getSyncStatusCached();
}
