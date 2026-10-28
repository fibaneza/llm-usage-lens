import {
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { afterAll, describe, expect, it } from "vitest";

import { createTable } from "./create-table";

// Source: docs/specs/2026-05-15-data-model.md — "Table Definition";
// implementation-phases Phase 3.2 — idempotent create-table script.
const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
  region: process.env.AWS_REGION ?? "us-east-1",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

const tableName = `bedrock-usage-test-ct-${Math.random().toString(36).slice(2, 10)}`;

afterAll(async () => {
  await client.send(new DeleteTableCommand({ TableName: tableName }));
  client.destroy();
});

describe("createTable", () => {
  it("creates the table, then reports it already exists on re-run", async () => {
    expect(await createTable(client, tableName)).toBe("created");
    expect(await createTable(client, tableName)).toBe("exists");
  });

  it("defines PK/SK string keys, GSI1 with ALL projection, on-demand billing", async () => {
    const { Table } = await client.send(
      new DescribeTableCommand({ TableName: tableName }),
    );

    expect(Table?.KeySchema).toEqual(
      expect.arrayContaining([
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ]),
    );
    expect(Table?.KeySchema).toHaveLength(2);

    const attrTypes = Object.fromEntries(
      (Table?.AttributeDefinitions ?? []).map((a) => [
        a.AttributeName,
        a.AttributeType,
      ]),
    );
    expect(attrTypes).toEqual({
      PK: "S",
      SK: "S",
      gsi1pk: "S",
      gsi1sk: "S",
    });

    const gsi = Table?.GlobalSecondaryIndexes?.find(
      (g) => g.IndexName === "GSI1",
    );
    expect(gsi).toBeDefined();
    expect(gsi?.KeySchema).toEqual([
      { AttributeName: "gsi1pk", KeyType: "HASH" },
      { AttributeName: "gsi1sk", KeyType: "RANGE" },
    ]);
    expect(gsi?.Projection?.ProjectionType).toBe("ALL");

    expect(Table?.BillingModeSummary?.BillingMode).toBe("PAY_PER_REQUEST");
  });
});
