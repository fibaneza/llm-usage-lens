import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_ENDPOINT, resolveTarget } from "./dynamodb-local";

// Source: Rule 50.1 / docs/specs/2026-05-15-implementation-phases.md — Phase
// 3.2: the scripts are DynamoDB-Local-only tooling and must never target real
// AWS (they hard-code dummy credentials).
const saved = process.env.DYNAMODB_ENDPOINT;

afterEach(() => {
  if (saved === undefined) delete process.env.DYNAMODB_ENDPOINT;
  else process.env.DYNAMODB_ENDPOINT = saved;
});

function withEndpoint(endpoint: string | undefined) {
  if (endpoint === undefined) delete process.env.DYNAMODB_ENDPOINT;
  else process.env.DYNAMODB_ENDPOINT = endpoint;
  return resolveTarget();
}

describe("resolveTarget — local-only guard", () => {
  it("defaults to the local endpoint when DYNAMODB_ENDPOINT is unset", () => {
    expect(withEndpoint(undefined).endpoint).toBe(DEFAULT_ENDPOINT);
  });

  it.each([
    "http://localhost:8001",
    "http://127.0.0.1:8000",
    "http://[::1]:8000",
    "http://dynamodb-local:8000",
  ])("accepts the local endpoint %s", (endpoint) => {
    expect(withEndpoint(endpoint).endpoint).toBe(endpoint);
  });

  it.each([
    "https://dynamodb.us-east-1.amazonaws.com",
    "https://vpce-0abc123-xyz.dynamodb.us-east-1.vpce.amazonaws.com",
    "https://localhost.evil.example.com",
    "not a url",
  ])("refuses the non-local endpoint %s", (endpoint) => {
    expect(() => withEndpoint(endpoint)).toThrow();
  });
});
