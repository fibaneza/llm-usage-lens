import "server-only";

import { unstable_cache } from "next/cache";

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
