import { BatchGetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/dynamodb", () => ({
  getDocumentClient: () => ({ send }),
  getTableName: () => "test-table",
}));

import { listStaleAccess } from "./pending-stale";

// Source: Rule 60.24 (no real timers or network) and the 4R.4 review carry-over:
// identitiesOf retries BatchGet UnprocessedKeys with backoff, at most 5
// attempts, then throws rather than looping forever or returning a silent
// partial result (Rule 60.17: no silent failures).
const NOW = new Date("2026-11-16T00:00:00.000Z");
const AFFILIATION = {
  oid: "oid-1",
  teamId: "t1",
  source: "ui",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "admin",
};
const IDENTITY = {
  PK: "IDENT#oid-1",
  SK: "META",
  oid: "oid-1",
  tid: "tid",
  lastSignInAt: "2026-01-01T00:00:00.000Z",
  lastSeenRoles: [],
  authMethod: "entra",
  version: 1,
};
const UNPROCESSED = {
  UnprocessedKeys: {
    "test-table": { Keys: [{ PK: "IDENT#oid-1", SK: "META" }] },
  },
};

const batchCalls = () =>
  send.mock.calls.filter(([cmd]) => cmd instanceof BatchGetCommand).length;

// Unprocessed for the first `stuck` BatchGets, then served: an uncapped retry
// loop terminates after `stuck` calls instead of hanging the worker.
function stuckFor(stuck: number) {
  let call = 0;
  return () =>
    ++call <= stuck
      ? { Responses: { "test-table": [] }, ...UNPROCESSED }
      : { Responses: { "test-table": [IDENTITY] } };
}

function respond(batch: () => unknown) {
  send.mockImplementation((cmd: unknown) => {
    if (cmd instanceof QueryCommand) {
      const input = cmd.input.ExpressionAttributeValues ?? {};
      const stale =
        input[":sk"] === "IDENT#" &&
        String(input[":pk"]).startsWith("MEMBERS#");
      return Promise.resolve({ Items: stale ? [AFFILIATION] : [] });
    }
    return Promise.resolve(batch());
  });
}

const list = () =>
  listStaleAccess(
    { teamIds: ["t1"], departmentIds: [], roleGrants: false, now: NOW },
    { cursorSecret: "secret" },
  );

beforeEach(() => {
  vi.useFakeTimers();
  send.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("listStaleAccess BatchGet retry", () => {
  it("retries UnprocessedKeys with backoff and then returns the row", async () => {
    respond(stuckFor(2));
    const pending = list();
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(batchCalls()).toBe(3);
    expect(result.ok && result.value.items).toHaveLength(1);
  });

  it("gives up after 5 attempts and throws instead of looping", async () => {
    respond(stuckFor(50));
    const pending = list();
    const settled = expect(pending).rejects.toThrow();
    await vi.runAllTimersAsync();
    await settled;
    expect(batchCalls()).toBe(5);
  });

  it("waits between attempts (backoff) rather than retrying immediately", async () => {
    respond(stuckFor(50));
    const pending = list();
    const settled = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(batchCalls()).toBe(1);
    await vi.runAllTimersAsync();
    await settled;
  });
});
