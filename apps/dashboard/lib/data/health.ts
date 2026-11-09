import "server-only";

import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

// Source: docs/specs/2026-11-10-platform.md — "Runtime / Health check".
// Bounded so a hung endpoint cannot stall the load balancer's health probe.
const DESCRIBE_TIMEOUT_MS = 2000;

export async function checkDynamoDb(): Promise<"ok" | "unreachable"> {
  try {
    await getDocumentClient().send(
      new DescribeTableCommand({ TableName: getTableName() }),
      { abortSignal: AbortSignal.timeout(DESCRIBE_TIMEOUT_MS) },
    );
    return "ok";
  } catch {
    // A failed dependency is the reported state, not an error (Rule 60.17).
    return "unreachable";
  }
}
