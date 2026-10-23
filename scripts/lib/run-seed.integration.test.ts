import { DynamoDBClient, DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTable } from "../create-table";
import { seedTable } from "./run-seed";

// Source: docs/specs/2026-05-15-implementation-phases.md — Phase 3.2
// (`db:seed:empty` reproduces the never-synced state, also after a prior
// default seed); Rule 20.9 (missing SyncStatus = "never synced").
const raw = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
  region: process.env.AWS_REGION ?? "us-east-1",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});
const doc = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});
const tableName = `bedrock-usage-test-rs-${Math.random().toString(36).slice(2, 10)}`;
const NOW = new Date("2026-10-23T00:30:00Z");

async function scanAll(): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await doc.send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey: startKey }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}

beforeAll(async () => {
  await createTable(raw, tableName);
});

afterAll(async () => {
  await raw.send(new DeleteTableCommand({ TableName: tableName }));
  raw.destroy();
});

describe("seedTable", () => {
  it("seeds the default profile with rollups and a SyncStatus", async () => {
    const counts = await seedTable(doc, tableName, "default", NOW, {
      reset: false,
    });
    expect(counts.accounts).toBeGreaterThan(0);
    expect(counts.rollups).toBeGreaterThan(0);
    const items = await scanAll();
    expect(items.filter((i) => String(i.SK).startsWith("DAILY#")).length).toBe(
      counts.rollups,
    );
    const sync = await doc.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: "SYSTEM", SK: "SYNC#LATEST" },
      }),
    );
    expect(sync.Item).toBeDefined();
  });

  it("empty + reset after a default seed leaves accounts but no rollups or SyncStatus", async () => {
    await seedTable(doc, tableName, "default", NOW, { reset: false });
    const counts = await seedTable(doc, tableName, "empty", NOW, {
      reset: true,
    });

    expect(counts.rollups).toBe(0);
    const items = await scanAll();
    expect(items.filter((i) => String(i.SK).startsWith("DAILY#"))).toEqual([]);
    expect(items.filter((i) => i.PK === "SYSTEM")).toEqual([]);
    const accounts = items.filter((i) => i.SK === "META");
    expect(accounts.length).toBe(counts.accounts);
    expect(accounts.length).toBeGreaterThan(0);
  });

  it("reset removes items not part of the new profile (e.g. large -> ranking account set)", async () => {
    await seedTable(doc, tableName, "large", NOW, { reset: false });
    const counts = await seedTable(doc, tableName, "ranking", NOW, {
      reset: true,
    });
    const items = await scanAll();
    expect(items.length).toBe(
      counts.accounts + counts.rollups + 1, // + SYSTEM/SYNC#LATEST
    );
  });

  it("without reset overlays on existing items (default behaviour kept)", async () => {
    await seedTable(doc, tableName, "default", NOW, { reset: true });
    const before = (await scanAll()).length;
    await seedTable(doc, tableName, "empty", NOW, { reset: false });
    expect((await scanAll()).length).toBe(before);
  });
});
