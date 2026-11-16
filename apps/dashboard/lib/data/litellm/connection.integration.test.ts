import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/support/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/test/support/access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  NOW,
  auditRecords,
  ctxAt,
  faults,
  ok,
  resetFaults,
} from "@/test/support/access-test-support";
import { getItem } from "../access/store";

import { getLiteLLMConnection, putLiteLLMConnection } from "./connection";

// Source: docs/specs/2026-11-10-litellm.md — "Data model additions"
// (LiteLLMConnection at LITELLM#CONFIG / CONNECTION, baseUrl only, versioned,
// never the key), "Security architecture" item 7 (versioned and audited);
// Access Control — "Audit log" (litellm.connection.update, same transaction;
// stale version -> CONFLICT and no record). Against DynamoDB Local (Rule 60.22).
const URL_A = "https://litellm.example.internal";
const URL_B = "https://litellm-b.example.internal";

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("getLiteLLMConnection", () => {
  it("returns null when never configured (a handled state, not an error)", async () => {
    expect(await getLiteLLMConnection()).toBeNull();
  });
});

describe("putLiteLLMConnection", () => {
  it("creates version 1 with version null, storing only baseUrl, version and updatedAt", async () => {
    const saved = ok(
      await putLiteLLMConnection({ baseUrl: URL_A, version: null }, ctxAt()),
    );
    expect(saved).toMatchObject({ baseUrl: URL_A, version: 1 });
    expect(await getLiteLLMConnection()).toEqual(saved);
    const raw = await getItem("LITELLM#CONFIG", "CONNECTION");
    expect(Object.keys(raw ?? {}).sort()).toEqual(
      ["PK", "SK", "baseUrl", "updatedAt", "version"].sort(),
    );
  });

  it("updates with the current version and increments it", async () => {
    ok(await putLiteLLMConnection({ baseUrl: URL_A, version: null }, ctxAt()));
    const second = ok(
      await putLiteLLMConnection(
        { baseUrl: URL_B, version: 1 },
        ctxAt(NOW, "req-2"),
      ),
    );
    expect(second).toMatchObject({ baseUrl: URL_B, version: 2 });
  });

  it("returns CONFLICT and writes nothing and no audit record on a stale version", async () => {
    ok(await putLiteLLMConnection({ baseUrl: URL_A, version: null }, ctxAt()));
    const before = (await auditRecords()).length;
    const result = await putLiteLLMConnection(
      { baseUrl: URL_B, version: 7 },
      ctxAt(NOW, "req-2"),
    );
    expect(result).toEqual({ ok: false, code: "CONFLICT" });
    expect((await getLiteLLMConnection())?.baseUrl).toBe(URL_A);
    expect(await auditRecords()).toHaveLength(before);
  });

  it("returns CONFLICT when creating with version null over an existing connection", async () => {
    ok(await putLiteLLMConnection({ baseUrl: URL_A, version: null }, ctxAt()));
    expect(
      await putLiteLLMConnection({ baseUrl: URL_B, version: null }, ctxAt()),
    ).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("commits one litellm.connection.update audit record with the before/after base URL", async () => {
    ok(await putLiteLLMConnection({ baseUrl: URL_A, version: null }, ctxAt()));
    ok(
      await putLiteLLMConnection(
        { baseUrl: URL_B, version: 1 },
        ctxAt(NOW, "req-2"),
      ),
    );
    const records = (await auditRecords()).filter(
      (r) => r.action === "litellm.connection.update",
    );
    expect(records).toHaveLength(2);
    const update = records.find((r) => r.requestId === "req-2");
    expect(update).toMatchObject({
      result: "success",
      category: "change",
      before: { baseUrl: URL_A },
      after: { baseUrl: URL_B },
    });
  });

  it("writes a failed audit record and rethrows when the write fails", async () => {
    faults.transact = true;
    await expect(
      putLiteLLMConnection({ baseUrl: URL_A, version: null }, ctxAt()),
    ).rejects.toBeDefined();
    resetFaults();
    expect(await getLiteLLMConnection()).toBeNull();
    const failed = (await auditRecords()).filter(
      (r) => r.action === "litellm.connection.update",
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.result).toBe("failed");
  });
});
