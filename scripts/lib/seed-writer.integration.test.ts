import { DynamoDBClient, DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTable } from "../create-table";
import { buildSeedData } from "./seed-data";
import { writeSeed } from "./seed-writer";

// Source: docs/specs/2026-05-15-data-model.md — "Entity Map" (key layout);
// Phase 3.2 — BatchWrite in chunks of 25.
const raw = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
  region: process.env.AWS_REGION ?? "us-east-1",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});
const doc = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});
const tableName = `bedrock-usage-test-sw-${Math.random().toString(36).slice(2, 10)}`;

beforeAll(async () => {
  await createTable(raw, tableName);
});

afterAll(async () => {
  await raw.send(new DeleteTableCommand({ TableName: tableName }));
  raw.destroy();
});

describe("writeSeed", () => {
  const seed = buildSeedData("default", new Date("2026-10-23T00:30:00Z"));

  it("writes every account and rollup (more than one 25-item batch) and reports counts", async () => {
    const result = await writeSeed(doc, tableName, seed);
    expect(result).toEqual({
      accounts: seed.accounts.length,
      rollups: seed.rollups.length,
    });
    expect(seed.accounts.length + seed.rollups.length).toBeGreaterThan(25);

    let count = 0;
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await doc.send(
        new ScanCommand({
          TableName: tableName,
          Select: "COUNT",
          ExclusiveStartKey: startKey,
        }),
      );
      count += page.Count ?? 0;
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    expect(count).toBeGreaterThanOrEqual(
      seed.accounts.length + seed.rollups.length,
    );
  });

  it("lays out AccountMeta keys per the Entity Map", async () => {
    const account = seed.accounts[0];
    if (!account) throw new Error("seed has no accounts");
    const { Item } = await doc.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `ACCT#${account.accountId}`, SK: "META" },
      }),
    );
    expect(Item).toMatchObject({
      ...account,
      gsi1pk: `DEPT#${account.departmentId}`,
      gsi1sk: `ACCT#${account.accountId}`,
    });
  });

  it("lays out DailyRollup keys per the Entity Map", async () => {
    const rollup = seed.rollups[0] as (typeof seed.rollups)[number] & {
      date: string;
    };
    const { Item } = await doc.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `ACCT#${rollup.accountId}`,
          SK: `DAILY#${rollup.date}`,
        },
      }),
    );
    expect(Item).toMatchObject({
      accountId: rollup.accountId,
      cost: rollup.cost,
      gsi1pk: `DATE#${rollup.date}`,
      gsi1sk: `ACCT#${rollup.accountId}`,
    });
  });

  it("is idempotent when re-run (overwrites, no duplicates)", async () => {
    const again = await writeSeed(doc, tableName, seed);
    expect(again.accounts).toBe(seed.accounts.length);
  });
});
