import { SyncStatusResultSchema } from "@bedrock-usage/shared";

import { getSyncStatusCached } from "@/lib/api/cached-reads";
import { jsonData, withRoute } from "@/lib/api/respond";

export const revalidate = 3600;

export const GET = withRoute(async () =>
  jsonData(SyncStatusResultSchema.parse(await getSyncStatusCached())),
);
