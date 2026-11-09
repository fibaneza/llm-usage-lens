import { pathToFileURL } from "node:url";

import {
  CreateTableCommand,
  DescribeTableCommand,
  ResourceInUseException,
  ResourceNotFoundException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GSI1_NAME } from "@llm-usage-lens/shared";

import { createScriptClient, log, resolveTarget } from "./lib/dynamodb-local";

const WAIT_SECONDS = 30;

async function tableExists(
  client: DynamoDBClient,
  tableName: string,
): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) return false;
    throw error;
  }
}

// Source: docs/specs/2026-05-15-data-model.md — "Table Definition".
// Idempotent: safe to re-run; resolves "exists" when the table is present.
export async function createTable(
  client: DynamoDBClient,
  tableName: string,
): Promise<"created" | "exists"> {
  let outcome: "created" | "exists" = "exists";

  if (!(await tableExists(client, tableName))) {
    try {
      await client.send(
        new CreateTableCommand({
          TableName: tableName,
          BillingMode: "PAY_PER_REQUEST",
          AttributeDefinitions: [
            { AttributeName: "PK", AttributeType: "S" },
            { AttributeName: "SK", AttributeType: "S" },
            { AttributeName: "gsi1pk", AttributeType: "S" },
            { AttributeName: "gsi1sk", AttributeType: "S" },
          ],
          KeySchema: [
            { AttributeName: "PK", KeyType: "HASH" },
            { AttributeName: "SK", KeyType: "RANGE" },
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: GSI1_NAME,
              KeySchema: [
                { AttributeName: "gsi1pk", KeyType: "HASH" },
                { AttributeName: "gsi1sk", KeyType: "RANGE" },
              ],
              Projection: { ProjectionType: "ALL" },
            },
          ],
        }),
      );
      outcome = "created";
    } catch (error) {
      // Lost a create race with another process — the table exists.
      if (!(error instanceof ResourceInUseException)) throw error;
    }
  }

  await waitUntilTableExists(
    { client, maxWaitTime: WAIT_SECONDS },
    { TableName: tableName },
  );
  return outcome;
}

async function main(): Promise<void> {
  const target = resolveTarget();
  const client = createScriptClient(target);
  try {
    const outcome = await createTable(client, target.tableName);
    log(`Table ${target.tableName} ${outcome} at ${target.endpoint}`);
  } finally {
    client.destroy();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `create-table failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
