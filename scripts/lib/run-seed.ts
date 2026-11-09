import { BatchWriteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { runBounded } from "@llm-usage-lens/shared";

import { createTable } from "../create-table";
import {
  createScriptClient,
  createScriptDocClient,
  log,
  resolveTarget,
} from "./dynamodb-local";
import { buildSeedData } from "./seed-data";
import type { SeedProfile } from "./seed-data";
import { writeSeed } from "./seed-writer";

const DELETE_BATCH_SIZE = 25;
const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 50;
const CONCURRENCY = 8;

type Key = { PK: string; SK: string };
type DeleteRequests = NonNullable<
  ConstructorParameters<typeof BatchWriteCommand>[0]["RequestItems"]
>[string];

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function deleteBatch(
  doc: DynamoDBDocumentClient,
  tableName: string,
  keys: Key[],
): Promise<void> {
  let pending: DeleteRequests = keys.map((Key) => ({ DeleteRequest: { Key } }));

  for (let attempt = 0; pending.length > 0; attempt += 1) {
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(
        `BatchWrite left ${pending.length} unprocessed deletes after ${MAX_ATTEMPTS} attempts`,
      );
    }
    if (attempt > 0) await sleep(BASE_BACKOFF_MS * 2 ** attempt);
    const response = await doc.send(
      new BatchWriteCommand({ RequestItems: { [tableName]: pending } }),
    );
    pending = response.UnprocessedItems?.[tableName] ?? [];
  }
}

// Parallel scan: DynamoDB Local pages are slow (~1 MB each), so segments run
// concurrently, each paginating on LastEvaluatedKey and deleting as it goes.
async function clearSegment(
  doc: DynamoDBDocumentClient,
  tableName: string,
  segment: number,
): Promise<void> {
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: "PK, SK",
        Segment: segment,
        TotalSegments: CONCURRENCY,
        ExclusiveStartKey: startKey,
      }),
    );
    const keys = (page.Items ?? []).map((item) => ({
      PK: String(item.PK),
      SK: String(item.SK),
    }));
    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      await deleteBatch(doc, tableName, keys.slice(i, i + DELETE_BATCH_SIZE));
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
}

async function clearTable(
  doc: DynamoDBDocumentClient,
  tableName: string,
): Promise<void> {
  const segments = Array.from({ length: CONCURRENCY }, (_, i) => i);
  await runBounded(segments, CONCURRENCY, (segment) =>
    clearSegment(doc, tableName, segment),
  );
}

// reset=true wipes the table first so the result matches the profile exactly;
// reset=false overlays (same keys overwrite, other items remain).
export async function seedTable(
  doc: DynamoDBDocumentClient,
  tableName: string,
  profile: SeedProfile,
  now: Date,
  options: { reset: boolean },
): Promise<{ accounts: number; rollups: number }> {
  if (options.reset) await clearTable(doc, tableName);
  return writeSeed(doc, tableName, buildSeedData(profile, now));
}

// Shared body of the seed CLIs. Only `empty` resets, so it reproduces the
// never-synced state even after a prior seed.
export async function runSeed(profile: SeedProfile): Promise<void> {
  const target = resolveTarget();
  const client = createScriptClient(target);
  try {
    await createTable(client, target.tableName);
    const counts = await seedTable(
      createScriptDocClient(client),
      target.tableName,
      profile,
      new Date(),
      { reset: profile === "empty" },
    );
    log(
      `Seeded "${profile}": ${counts.accounts} accounts, ${counts.rollups} rollups -> ${target.tableName} at ${target.endpoint}`,
    );
  } finally {
    client.destroy();
  }
}

export function runSeedCli(profile: SeedProfile): void {
  runSeed(profile).catch((error: unknown) => {
    process.stderr.write(
      `seed ${profile} failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
