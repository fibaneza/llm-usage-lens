import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME_DEFAULT } from "@bedrock-usage/shared";

// Dev tooling that runs outside Next.js, so it reads process.env directly —
// the documented exception to Rule 50.2 (the dashboard uses @t3-oss/env-nextjs).
export const DEFAULT_ENDPOINT = "http://localhost:8000";

export type ScriptTarget = {
  endpoint: string;
  region: string;
  tableName: string;
};

// Scripts only ever target DynamoDB Local: an unset endpoint falls back to
// localhost:8000, never to real AWS (Rule 50.1 — no static AWS keys).
export function resolveTarget(): ScriptTarget {
  return {
    endpoint: process.env.DYNAMODB_ENDPOINT ?? DEFAULT_ENDPOINT,
    region: process.env.AWS_REGION ?? "us-east-1",
    tableName: process.env.DYNAMODB_TABLE_NAME ?? TABLE_NAME_DEFAULT,
  };
}

export function createScriptClient(target: ScriptTarget): DynamoDBClient {
  return new DynamoDBClient({
    endpoint: target.endpoint,
    region: target.region,
    // Dummy values DynamoDB Local requires — not real keys.
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
}

export function createScriptDocClient(
  client: DynamoDBClient,
): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export function log(message: string): void {
  process.stdout.write(`${message}\n`);
}
