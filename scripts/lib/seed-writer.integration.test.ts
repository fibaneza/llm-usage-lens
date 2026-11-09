import { DynamoDBClient, DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { DailyRollupItemSchema } from "@llm-usage-lens/shared";
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

  // Source: docs/specs/2026-05-15-data-model.md — "`date` attribute": seed
  // scripts write `date`; the write-side item schema checks it against SK/gsi1pk.
  it("writes every rollup item so that it passes DailyRollupItemSchema", async () => {
    await writeSeed(doc, tableName, seed);
    let checked = 0;
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await doc.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: "begins_with(SK, :daily)",
          ExpressionAttributeValues: { ":daily": "DAILY#" },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of page.Items ?? []) {
        const parsed = DailyRollupItemSchema.safeParse(item);
        expect(parsed.success).toBe(true);
        checked += 1;
      }
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    expect(checked).toBe(seed.rollups.length);
  });

  it("persists nonModel on the rollup item unchanged", async () => {
    await writeSeed(doc, tableName, seed);
    const withNonModel = seed.rollups.find((r) => r.nonModel);
    if (!withNonModel) throw new Error("default seed has no nonModel rollup");
    const { Item } = await doc.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `ACCT#${withNonModel.accountId}`,
          SK: `DAILY#${withNonModel.date}`,
        },
      }),
    );
    expect(Item?.nonModel).toEqual(withNonModel.nonModel);
    expect(Item?.date).toBe(withNonModel.date);
  });

  // Source: docs/specs/2026-05-15-data-model.md — "`date` attribute" (write-side
  // DailyRollupItemSchema is the gate); Rule 60.17 (no silent failures).
  describe("rejects an invalid rollup before writing anything", () => {
    const countItems = async (table: string): Promise<number> => {
      let count = 0;
      let startKey: Record<string, unknown> | undefined;
      do {
        const page = await doc.send(
          new ScanCommand({
            TableName: table,
            Select: "COUNT",
            ExclusiveStartKey: startKey,
          }),
        );
        count += page.Count ?? 0;
        startKey = page.LastEvaluatedKey;
      } while (startKey);
      return count;
    };

    const freshTable = async (): Promise<string> => {
      const name = `bedrock-usage-test-swr-${Math.random().toString(36).slice(2, 10)}`;
      await createTable(raw, name);
      return name;
    };

    const [good, victim] = seed.rollups;
    if (!good || !victim) throw new Error("default seed has too few rollups");

    it.each([
      ["a broken cost invariant", { ...victim, cost: victim.cost + 1 }],
      ["a malformed date", { ...victim, date: "2026-13-01" }],
    ])("writes nothing when a rollup has %s", async (_label, bad) => {
      const table = await freshTable();
      try {
        const data = {
          ...seed,
          rollups: [...seed.rollups.filter((r) => r !== victim), bad],
        };
        await expect(writeSeed(doc, table, data)).rejects.toThrow();
        expect(await countItems(table)).toBe(0);
      } finally {
        await raw.send(new DeleteTableCommand({ TableName: table }));
      }
    });
  });

  it("is idempotent when re-run (overwrites, no duplicates)", async () => {
    const again = await writeSeed(doc, tableName, seed);
    expect(again.accounts).toBe(seed.accounts.length);
  });
});
