import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/support/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/test/support/access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  ACTOR,
  NOW,
  auditRecords,
  ctxAt,
  faults,
  ok,
  resetFaults,
} from "@/test/support/access-test-support";
import {
  createPendingItem,
  deletePendingItem,
  listPendingFor,
} from "./pending";

// Source: docs/specs/2026-11-10-access-control.md — "Membership, admin scopes
// and lifecycle" (Joiner: pre-staged membership by email/UPN), "Audit log";
// contract R2 §2 (PendingItem), §4 (ALREADY_AFFILIATED for a pending
// affiliation, CONFLICT otherwise), addendum B.4. Emails are lower-cased.
const ctx = ctxAt();
const affiliation = (email: string, teamId = "t1") =>
  ({ kind: "affiliation", emailOrUpn: email, teamId }) as const;
const scope = (email: string, scopeId = "t1") =>
  ({
    kind: "adminScope",
    emailOrUpn: email,
    scopeType: "team",
    scopeId,
  }) as const;

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("createPendingItem", () => {
  it("creates a lower-cased pending affiliation with one pending.create record", async () => {
    const item = ok(
      await createPendingItem(affiliation("Ada@Example.COM"), ctx),
    );
    expect(item).toMatchObject({
      kind: "affiliation",
      emailOrUpn: "ada@example.com",
      teamId: "t1",
      createdBy: ACTOR,
      version: 1,
    });
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "pending.create",
      category: "change",
      result: "success",
    });
  });

  it("creates a pending admin scope", async () => {
    const item = ok(await createPendingItem(scope("ada@example.com"), ctx));
    expect(item).toMatchObject({
      kind: "adminScope",
      scopeType: "team",
      scopeId: "t1",
    });
  });

  it("returns ALREADY_AFFILIATED for a second pending affiliation (any case), no record", async () => {
    ok(await createPendingItem(affiliation("ada@example.com"), ctx));
    expect(
      await createPendingItem(
        affiliation("ADA@example.com", "t2"),
        ctxAt(NOW, "req-2"),
      ),
    ).toEqual({ ok: false, code: "ALREADY_AFFILIATED" });
    expect(await auditRecords()).toHaveLength(1);
  });

  it("returns CONFLICT for a duplicate pending admin scope, no record", async () => {
    ok(await createPendingItem(scope("ada@example.com"), ctx));
    expect(
      await createPendingItem(scope("ada@example.com"), ctxAt(NOW, "req-2")),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await auditRecords()).toHaveLength(1);
  });

  it("writes one failed record and rethrows on a downstream failure", async () => {
    faults.transact = true;
    await expect(
      createPendingItem(affiliation("ada@example.com"), ctx),
    ).rejects.toThrow();
    faults.transact = false;
    expect(await listPendingFor(["ada@example.com"])).toEqual([]);
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "pending.create",
      result: "failed",
    });
  });
});

describe("listPendingFor", () => {
  it("returns both kinds for the given emails or UPNs, case-insensitively", async () => {
    ok(await createPendingItem(affiliation("ada@example.com"), ctx));
    ok(await createPendingItem(scope("ada@example.com"), ctxAt(NOW, "r2")));
    ok(
      await createPendingItem(affiliation("bob@example.com"), ctxAt(NOW, "r3")),
    );
    ok(
      await createPendingItem(affiliation("eve@example.com"), ctxAt(NOW, "r4")),
    );
    const found = await listPendingFor(["ADA@example.com", "bob@example.com"]);
    expect(found).toHaveLength(3);
    expect(new Set(found.map((p) => p.emailOrUpn))).toEqual(
      new Set(["ada@example.com", "bob@example.com"]),
    );
  });

  it("returns [] for no emails or no matches", async () => {
    expect(await listPendingFor([])).toEqual([]);
    expect(await listPendingFor(["nobody@example.com"])).toEqual([]);
  });
});

describe("deletePendingItem", () => {
  it("deletes the item and writes one pending.delete record", async () => {
    const item = ok(
      await createPendingItem(affiliation("ada@example.com"), ctx),
    );
    expect(
      await deletePendingItem(
        { item, version: item.version },
        ctxAt(NOW, "req-2"),
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(await listPendingFor(["ada@example.com"])).toEqual([]);
    expect((await auditRecords()).map((r) => r.action)).toEqual([
      "pending.create",
      "pending.delete",
    ]);
  });

  it("returns CONFLICT on a stale version and NOT_FOUND when missing, with no record", async () => {
    const item = ok(
      await createPendingItem(affiliation("ada@example.com"), ctx),
    );
    const r2 = ctxAt(NOW, "req-2");
    expect(
      await deletePendingItem({ item, version: item.version + 1 }, r2),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(
      await deletePendingItem(
        { item: affiliation("ghost@example.com") as never, version: 1 },
        r2,
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await listPendingFor(["ada@example.com"])).toHaveLength(1);
    expect(await auditRecords()).toHaveLength(1);
  });
});
