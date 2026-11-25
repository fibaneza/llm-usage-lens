import { SyncStatusResultSchema } from "@llm-usage-lens/shared";

import {
  getSyncStatusCached,
  refreshSyncStatusCached,
} from "@/lib/api/cached-reads";
import { jsonData, withRoute } from "@/lib/api/respond";

export const revalidate = 3600;

// withRoute checks the session first (Rule 50.4); only then is the header read.
export const GET = withRoute(async (req) => {
  const bypass = /(^|,)\s*no-cache\s*(,|$)/i.test(
    req.headers.get("cache-control") ?? "",
  );
  const status = bypass
    ? await refreshSyncStatusCached()
    : await getSyncStatusCached();
  return jsonData(SyncStatusResultSchema.parse(status));
});
