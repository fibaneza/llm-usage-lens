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

const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "dynamodb-local",
]);

// Twin of isLocalEndpoint in apps/dashboard/lib/dynamodb.ts (server-only, so
// not importable here).
function isLocalEndpoint(endpoint: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

// Scripts only ever target DynamoDB Local: an unset endpoint falls back to
// localhost:8000 and a non-local endpoint is refused, never real AWS
// (Rule 50.1 — no static AWS keys).
export function resolveTarget(): ScriptTarget {
  const endpoint = process.env.DYNAMODB_ENDPOINT ?? DEFAULT_ENDPOINT;
  if (!isLocalEndpoint(endpoint)) {
    throw new Error(
      `Refusing to run against non-local DYNAMODB_ENDPOINT "${endpoint}": scripts target DynamoDB Local only (localhost, 127.0.0.1, [::1], dynamodb-local).`,
    );
  }
  return {
    endpoint,
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
