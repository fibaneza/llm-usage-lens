import "server-only";

import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { SYNC_SK, SYSTEM_PK, SyncStatusSchema } from "@bedrock-usage/shared";
import type { SyncStatus } from "@bedrock-usage/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: SyncStatus";
// Rule 20.9 (a missing item is the "never synced" state, not an error).

export type SyncStatusResult =
  | { state: "never-synced" }
  | { state: "synced"; status: SyncStatus };

export async function getSyncStatus(): Promise<SyncStatusResult> {
  const { Item } = await getDocumentClient().send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: SYSTEM_PK, SK: SYNC_SK },
    }),
  );
  if (!Item) return { state: "never-synced" };
  return { state: "synced", status: SyncStatusSchema.parse(Item) };
}
