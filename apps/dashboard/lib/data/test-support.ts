// Test-only helpers for the DynamoDB Local integration tests (Rule 60.22 —
// data-access is tested against a real table, never mocks). Not imported by
// production code.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AccountMeta, DailyRollup } from "@bedrock-usage/shared";

import { createTable } from "../../../../scripts/create-table";
import { writeSeed } from "../../../../scripts/lib/seed-writer";

export const TEST_TABLE_NAME =
  process.env.DYNAMODB_TABLE_NAME ?? "bedrock-usage-test";

export type DatedRollup = DailyRollup & { date: string };

let rawCached: DynamoDBClient | undefined;
let cached: DynamoDBDocumentClient | undefined;

function rawClient(): DynamoDBClient {
  rawCached ??= new DynamoDBClient({
    endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  return rawCached;
}

export function testDoc(): DynamoDBDocumentClient {
  cached ??= DynamoDBDocumentClient.from(rawClient(), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return cached;
}

export async function ensureTestTable(): Promise<void> {
  await createTable(rawClient(), TEST_TABLE_NAME);
}

export async function clearTable(): Promise<void> {
  const doc = testDoc();
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: TEST_TABLE_NAME,
        ProjectionExpression: "PK, SK",
        ExclusiveStartKey: startKey,
      }),
    );
    const items = page.Items ?? [];
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      let pending: Record<string, unknown>[] = chunk;
      while (pending.length > 0) {
        const res = await doc.send(
          new BatchWriteCommand({
            RequestItems: {
              [TEST_TABLE_NAME]: pending.map((Key) => ({
                DeleteRequest: { Key: { PK: Key.PK, SK: Key.SK } },
              })),
            },
          }),
        );
        pending = (res.UnprocessedItems?.[TEST_TABLE_NAME] ?? []).map(
          (r) => r.DeleteRequest?.Key ?? {},
        );
      }
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
}

export async function loadFixtures(data: {
  accounts?: AccountMeta[];
  rollups?: DatedRollup[];
}): Promise<void> {
  await writeSeed(testDoc(), TEST_TABLE_NAME, {
    accounts: data.accounts ?? [],
    rollups: data.rollups ?? [],
    syncStatus: null,
  } as Parameters<typeof writeSeed>[2]);
}

export async function putRaw(item: Record<string, unknown>): Promise<void> {
  await testDoc().send(
    new PutCommand({ TableName: TEST_TABLE_NAME, Item: item }),
  );
}

export function makeAccount(
  n: number,
  overrides: Partial<AccountMeta> = {},
): AccountMeta {
  return {
    accountId: String(n).padStart(12, "0"),
    accountName: `account-${n}`,
    departmentId: "dept-engineering",
    departmentName: "Engineering",
    teamId: "team-payments",
    teamName: "Payments",
    region: "us-east-1",
    active: true,
    createdAt: "2026-05-15T08:00:00.000Z",
    updatedAt: "2026-05-15T08:00:00.000Z",
    ...overrides,
  };
}

const ENTRY = {
  cost: 0.5,
  costEstimated: true,
  inputTokens: 1000,
  outputTokens: 500,
  invocations: 2,
};

export function makeRollup(
  account: AccountMeta,
  date: string,
  options: { cost?: number; userCount?: number } = {},
): DatedRollup {
  const cost = options.cost ?? 10;
  const byUser: Record<string, typeof ENTRY> = {};
  for (let i = 0; i < (options.userCount ?? 1); i += 1) {
    byUser[`user-${String(i).padStart(4, "0")}@company.com`] = ENTRY;
  }
  return {
    date,
    accountId: account.accountId,
    departmentId: account.departmentId,
    departmentName: account.departmentName,
    teamId: account.teamId,
    teamName: account.teamName,
    cost,
    costFinalized: true,
    inputTokens: 1000,
    outputTokens: 500,
    invocations: 2,
    models: {
      "claude-sonnet": {
        cost,
        costEstimated: false,
        inputTokens: 1000,
        outputTokens: 500,
        invocations: 2,
        byUser,
        byService: { "payments-api": ENTRY, _untagged: ENTRY },
      },
    },
    lastUpdatedAt: `${date}T13:00:00.000Z`,
    ttl: 1_900_000_000,
  };
}

export function stripDate(rollup: DatedRollup): DailyRollup {
  const domain: Partial<Pick<DatedRollup, "date">> & DailyRollup = {
    ...rollup,
  };
  delete domain.date;
  return domain;
}
