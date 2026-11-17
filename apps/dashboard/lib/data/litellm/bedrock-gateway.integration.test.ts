import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/support/test-support";

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

import { getBedrockGateway, putBedrockGateway } from "./bedrock-gateway";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage (L6)
// -> Gateway configuration" (Entity GatewayConfig at LITELLM#CONFIG / GATEWAY,
// versioned; every account id must exist in AccountMeta; each successful
// write appends one audit record litellm.gateway.update, target
// litellm-gateway/default, the lists before and after, in the same
// transaction; a stale version -> CONFLICT, no record; no stored item is a
// handled state), "Read per request, never cached" (LT33), LT29; shared
// contract 4 (audit: success exactly one record, failed one record, 409 none).
// Against DynamoDB Local (Rule 60.22).
//
// Contract for the developer (lib/data/litellm/bedrock-gateway.ts, server-only):
//   getBedrockGateway(): Promise<BedrockGatewayConfig | null>
//   putBedrockGateway({ version: number | null, principals, accountIds }, ctx:
//     AuditContext): Promise<AccessResult<BedrockGatewayConfig>>
//     - ok: item { principals, accountIds, version, updatedAt: ctx.now ISO,
//       updatedBy: ctx.actor }; version null creates version 1.
//     - { ok: false, code: "CONFLICT" } on a stale version or a create over an
//       existing item; { ok: false, code: "NOT_FOUND" } when an account id has
//       no AccountMeta (nothing stored, no record). The route maps NOT_FOUND to
//       400 BAD_REQUEST.
//   Audit before/after (string-list snapshot values only): { version,
//   principals: ["<type>:<value>", ...], accountIds: [...] }; before is absent
//   on the first write.
const ACCT = "000000000001";
const ACCT_2 = "000000000002";
const ROLE = { type: "iam-role" as const, value: "litellm-bedrock" };
const KEY = { type: "usage-key" as const, value: "svc-gateway" };

const input = (
  over: Partial<Parameters<typeof putBedrockGateway>[0]> = {},
) => ({
  version: null,
  principals: [ROLE],
  accountIds: [ACCT],
  ...over,
});

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
  await loadFixtures({ accounts: [makeAccount(1), makeAccount(2)] });
});

const gatewayRecords = async () =>
  (await auditRecords()).filter((r) => r.action === "litellm.gateway.update");

describe("getBedrockGateway", () => {
  it("returns null when never configured (a handled state, not an error)", async () => {
    expect(await getBedrockGateway()).toBeNull();
  });
});

describe("putBedrockGateway", () => {
  it("creates version 1 with version null and stores principals, account ids, who and when", async () => {
    const saved = ok(await putBedrockGateway(input(), ctxAt()));
    expect(saved).toEqual({
      principals: [ROLE],
      accountIds: [ACCT],
      version: 1,
      updatedAt: NOW.toISOString(),
      updatedBy: ctxAt().actor,
    });
    expect(await getBedrockGateway()).toEqual(saved);
    const raw = await getItem("LITELLM#CONFIG", "GATEWAY");
    expect(Object.keys(raw ?? {}).sort()).toEqual(
      [
        "PK",
        "SK",
        "accountIds",
        "principals",
        "updatedAt",
        "updatedBy",
        "version",
      ].sort(),
    );
  });

  it("updates with the current version, increments it, and a read sees the write at once (LT33: never cached)", async () => {
    ok(await putBedrockGateway(input(), ctxAt()));
    const second = ok(
      await putBedrockGateway(
        input({ version: 1, principals: [KEY], accountIds: [ACCT, ACCT_2] }),
        ctxAt(NOW, "req-2"),
      ),
    );
    expect(second).toMatchObject({
      version: 2,
      principals: [KEY],
      accountIds: [ACCT, ACCT_2],
    });
    expect(await getBedrockGateway()).toEqual(second);
  });

  it("accepts both lists empty (clear) and keeps the item at a new version", async () => {
    ok(await putBedrockGateway(input(), ctxAt()));
    const cleared = ok(
      await putBedrockGateway(
        input({ version: 1, principals: [], accountIds: [] }),
        ctxAt(NOW, "req-2"),
      ),
    );
    expect(cleared).toMatchObject({
      version: 2,
      principals: [],
      accountIds: [],
    });
    expect(await getBedrockGateway()).toMatchObject({ version: 2 });
  });

  it("returns CONFLICT and writes nothing and no audit record on a stale version (409)", async () => {
    ok(await putBedrockGateway(input(), ctxAt()));
    const before = (await auditRecords()).length;
    const result = await putBedrockGateway(
      input({ version: 7, principals: [KEY] }),
      ctxAt(NOW, "req-2"),
    );
    expect(result).toEqual({ ok: false, code: "CONFLICT" });
    expect((await getBedrockGateway())?.principals).toEqual([ROLE]);
    expect(await auditRecords()).toHaveLength(before);
  });

  it("returns CONFLICT when creating with version null over an existing item, and when updating a missing one", async () => {
    ok(await putBedrockGateway(input(), ctxAt()));
    expect(await putBedrockGateway(input(), ctxAt())).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    await clearTable();
    await loadFixtures({ accounts: [makeAccount(1)] });
    expect(await putBedrockGateway(input({ version: 1 }), ctxAt())).toEqual({
      ok: false,
      code: "CONFLICT",
    });
  });

  it("rejects an account id that has no AccountMeta: NOT_FOUND, nothing stored, no audit record", async () => {
    const result = await putBedrockGateway(
      input({ accountIds: [ACCT, "999999999999"] }),
      ctxAt(),
    );
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await getBedrockGateway()).toBeNull();
    expect(await gatewayRecords()).toHaveLength(0);
  });

  it("commits exactly one litellm.gateway.update record per write: target litellm-gateway/default, lists before and after", async () => {
    ok(await putBedrockGateway(input(), ctxAt()));
    ok(
      await putBedrockGateway(
        input({ version: 1, principals: [ROLE, KEY], accountIds: [] }),
        ctxAt(NOW, "req-2"),
      ),
    );
    const records = await gatewayRecords();
    expect(records).toHaveLength(2);
    const first = records.find((r) => r.requestId === "req-1");
    expect(first).toMatchObject({
      result: "success",
      category: "change",
      target: { type: "litellm-gateway", id: "default" },
      after: {
        version: 1,
        principals: ["iam-role:litellm-bedrock"],
        accountIds: [ACCT],
      },
    });
    expect(first).not.toHaveProperty("before");
    const second = records.find((r) => r.requestId === "req-2");
    expect(second).toMatchObject({
      result: "success",
      target: { type: "litellm-gateway", id: "default" },
      before: {
        version: 1,
        principals: ["iam-role:litellm-bedrock"],
        accountIds: [ACCT],
      },
      after: {
        version: 2,
        principals: ["iam-role:litellm-bedrock", "usage-key:svc-gateway"],
        accountIds: [],
      },
    });
  });

  it("writes a failed audit record in the same attempt and rethrows when the transaction fails; nothing is stored", async () => {
    faults.transact = true;
    await expect(putBedrockGateway(input(), ctxAt())).rejects.toBeDefined();
    resetFaults();
    expect(await getBedrockGateway()).toBeNull();
    const records = await gatewayRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.result).toBe("failed");
  });
});
