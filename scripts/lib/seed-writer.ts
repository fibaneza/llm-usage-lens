import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  META_SK,
  SYNC_SK,
  SYSTEM_PK,
  accountPk,
  dailySk,
  datePk,
  deptPk,
} from "@bedrock-usage/shared";

import type { SeedData } from "./seed-data";
import { runBounded } from "./run-bounded";

// Source: docs/specs/2026-05-15-data-model.md — "Entity Map" (key layout).
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 50;
const CONCURRENCY = 8;

type Item = Record<string, unknown>;
type WriteRequests = NonNullable<
  ConstructorParameters<typeof BatchWriteCommand>[0]["RequestItems"]
>[string];

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function writeBatch(
  doc: DynamoDBDocumentClient,
  tableName: string,
  items: Item[],
): Promise<void> {
  let pending: WriteRequests = items.map((Item) => ({ PutRequest: { Item } }));

  for (let attempt = 0; pending.length > 0; attempt += 1) {
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(
        `BatchWrite left ${pending.length} unprocessed items after ${MAX_ATTEMPTS} attempts`,
      );
    }
    if (attempt > 0) await sleep(BASE_BACKOFF_MS * 2 ** attempt);
    const response = await doc.send(
      new BatchWriteCommand({ RequestItems: { [tableName]: pending } }),
    );
    pending = response.UnprocessedItems?.[tableName] ?? [];
  }
}

export async function writeSeed(
  doc: DynamoDBDocumentClient,
  tableName: string,
  data: SeedData,
): Promise<{ accounts: number; rollups: number }> {
  const items: Item[] = [
    ...data.accounts.map((account) => ({
      ...account,
      PK: accountPk(account.accountId),
      SK: META_SK,
      gsi1pk: deptPk(account.departmentId),
      gsi1sk: accountPk(account.accountId),
    })),
    ...data.rollups.map((rollup) => ({
      ...rollup,
      PK: accountPk(rollup.accountId),
      SK: dailySk(rollup.date),
      gsi1pk: datePk(rollup.date),
      gsi1sk: accountPk(rollup.accountId),
    })),
  ];
  if (data.syncStatus) {
    items.push({ ...data.syncStatus, PK: SYSTEM_PK, SK: SYNC_SK });
  }

  const batches: Item[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }
  await runBounded(batches, CONCURRENCY, (batch) =>
    writeBatch(doc, tableName, batch),
  );

  return { accounts: data.accounts.length, rollups: data.rollups.length };
}
