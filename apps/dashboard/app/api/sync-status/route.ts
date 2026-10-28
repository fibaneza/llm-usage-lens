import { SyncStatusResultSchema } from "@bedrock-usage/shared";

import { jsonData, withRoute } from "@/lib/api/respond";
import { getSyncStatus } from "@/lib/data/sync-status";

export const revalidate = 3600;

export const GET = withRoute(async () =>
  jsonData(SyncStatusResultSchema.parse(await getSyncStatus())),
);
