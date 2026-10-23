import { describe, expect, it } from "vitest";

import { isLocalEndpoint } from "./dynamodb";

// Source: Rule 50.1 — dummy "local" credentials may be used only against
// DynamoDB Local; real AWS must use the default credential chain.
// Lives in the integration project (node env, `server-only` aliased to a stub)
// because lib/dynamodb.ts imports "server-only", which throws under the unit
// project. It needs no DynamoDB Local connection itself.
describe("isLocalEndpoint", () => {
  it.each([
    "http://localhost:8000",
    "https://localhost",
    "http://localhost:8001",
    "http://127.0.0.1:8000",
    "http://[::1]:8000",
    "http://dynamodb-local:8000",
    "http://dynamodb-local",
  ])("is true for %s", (endpoint) => {
    expect(isLocalEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "https://dynamodb.us-east-1.amazonaws.com",
    "https://vpce-0abc123-xyz.dynamodb.us-east-1.vpce.amazonaws.com",
    "http://localhost.evil.example.com:8000",
    "http://dynamodb-local.example.com",
    "",
    "not a url",
    "localhost:8000",
  ])("is false for %j", (endpoint) => {
    expect(isLocalEndpoint(endpoint)).toBe(false);
  });
});
