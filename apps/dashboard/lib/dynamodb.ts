import "server-only";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { env } from "@/env";

// Source: docs/specs/2026-05-15-implementation-phases.md — Phase 3.2 (document
// client, configurable endpoint for DynamoDB Local vs AWS); Rules 10, 50.

const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "dynamodb-local",
]);

// Twin of the check in scripts/lib/dynamodb-local.ts (scripts cannot import
// this server-only module).
export function isLocalEndpoint(endpoint: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

let cached: DynamoDBDocumentClient | undefined;

export function getDocumentClient(): DynamoDBDocumentClient {
  if (cached) return cached;
  const endpoint = env.DYNAMODB_ENDPOINT;
  const client = new DynamoDBClient({
    region: env.AWS_REGION,
    ...(endpoint ? { endpoint } : {}),
    // Not real AWS keys: DynamoDB Local requires some credentials. Any other
    // endpoint, and real AWS, use the default chain (Rule 50.1).
    ...(endpoint && isLocalEndpoint(endpoint)
      ? { credentials: { accessKeyId: "local", secretAccessKey: "local" } }
      : {}),
  });
  cached = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return cached;
}

export function getTableName(): string {
  return env.DYNAMODB_TABLE_NAME;
}
