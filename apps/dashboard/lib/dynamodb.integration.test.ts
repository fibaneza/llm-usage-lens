import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { clearTable, ensureTestTable } from "@/test/support/test-support";

// Source: implementation-phases Phase 3.2 — "AWS SDK v3 document client;
// configurable endpoint (DynamoDB Local vs AWS)"; Rule 10.
beforeAll(async () => {
  await ensureTestTable();
  await clearTable();
});
afterAll(clearTable);

describe("dynamodb client", () => {
  it("returns a singleton document client", () => {
    expect(getDocumentClient()).toBe(getDocumentClient());
  });

  it("reads the table name from DYNAMODB_TABLE_NAME", () => {
    expect(getTableName()).toBe(process.env.DYNAMODB_TABLE_NAME);
  });

  it("talks to the configured endpoint and drops undefined attributes", async () => {
    const doc = getDocumentClient();
    const TableName = getTableName();
    await doc.send(
      new PutCommand({
        TableName,
        Item: { PK: "TEST#client", SK: "X", present: 1, absent: undefined },
      }),
    );
    const { Item } = await doc.send(
      new GetCommand({ TableName, Key: { PK: "TEST#client", SK: "X" } }),
    );
    expect(Item).toEqual({ PK: "TEST#client", SK: "X", present: 1 });
  });
});
