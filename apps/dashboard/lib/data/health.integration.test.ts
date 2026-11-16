import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ensureTestTable } from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-platform.md — "Runtime / Health check";
// Rule 60.22 (DynamoDB Local, no AWS). checkDynamoDb runs DescribeTable on the
// configured table, bounded by a short timeout, and never throws.

const mode = vi.hoisted(() => ({
  value: "real" as "real" | "missing-table" | "dead-endpoint",
}));

vi.mock("@/lib/dynamodb", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/dynamodb")>("@/lib/dynamodb");
  return {
    ...actual,
    getTableName: () =>
      mode.value === "missing-table"
        ? "table-that-does-not-exist"
        : actual.getTableName(),
    getDocumentClient: () =>
      mode.value === "dead-endpoint"
        ? DynamoDBDocumentClient.from(
            new DynamoDBClient({
              region: "ap-southeast-2",
              endpoint: "http://127.0.0.1:1",
              credentials: { accessKeyId: "local", secretAccessKey: "local" },
              maxAttempts: 1,
            }),
          )
        : actual.getDocumentClient(),
  };
});

import { checkDynamoDb } from "@/lib/data/health";

beforeAll(ensureTestTable);

describe("checkDynamoDb", () => {
  it("returns ok when the table exists", async () => {
    mode.value = "real";
    await expect(checkDynamoDb()).resolves.toBe("ok");
  });

  it("returns unreachable (does not throw) when the table is missing", async () => {
    mode.value = "missing-table";
    await expect(checkDynamoDb()).resolves.toBe("unreachable");
  });

  it("returns unreachable (does not throw) when the endpoint refuses connections", async () => {
    mode.value = "dead-endpoint";
    await expect(checkDynamoDb()).resolves.toBe("unreachable");
  });
});
