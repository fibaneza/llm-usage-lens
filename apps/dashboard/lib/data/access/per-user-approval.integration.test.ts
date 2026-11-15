import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("./access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  ACTOR,
  NOW,
  auditRecords,
  ctxAt,
  faults,
  ok,
  resetFaults,
} from "./access-test-support";
import { getPerUserApproval, setPerUserApproval } from "./per-user-approval";

// Source: docs/specs/2026-11-10-access-control.md - "Visibility and
// inheritance" (organisation cap: who, when, reference; audited), "Data model
// additions" (PerUserApproval at GOVERNANCE/PER_USER), "Audit log" (a success
// commits its record in the same transaction; a condition failure writes none;
// any other failure writes one `failed` record), "Enforcement" item 6
// (version, stale -> CONFLICT). Contract: contract-slice3.md. Assumed API:
// setPerUserApproval({ reference, version }, ctx) -> AccessResult<PerUserApproval>
// where `version` is the current stored version (0 when nothing is recorded),
// who = ctx.actor and when = ctx.now. Withdrawal is not defined by the spec.
beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("setPerUserApproval", () => {
  it("records the first approval at version 0: who, when, reference, version 1, one governance.approval.update record", async () => {
    const value = ok(
      await setPerUserApproval(
        { reference: "WC-2026-14", version: 0 },
        ctxAt(),
      ),
    );
    expect(value).toEqual({
      approvedBy: ACTOR,
      approvedAt: NOW.toISOString(),
      reference: "WC-2026-14",
      version: 1,
    });
    expect(await getPerUserApproval()).toEqual(value);
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "governance.approval.update",
      category: "change",
      result: "success",
      actor: ACTOR,
    });
    expect(records[0]?.target).toBeDefined();
  });

  it("re-approving at the current version replaces who/when/reference and bumps the version", async () => {
    ok(await setPerUserApproval({ reference: "first", version: 0 }, ctxAt()));
    const later = new Date("2026-11-20T08:00:00.000Z");
    const value = ok(
      await setPerUserApproval(
        { reference: "second", version: 1 },
        { ...ctxAt(later, "req-2"), actor: "other-admin" },
      ),
    );
    expect(value).toEqual({
      approvedBy: "other-admin",
      approvedAt: later.toISOString(),
      reference: "second",
      version: 2,
    });
    expect(await getPerUserApproval()).toEqual(value);
  });

  it.each([
    ["a version when nothing is recorded", 3],
    ["a version of 0 once approved", 0],
  ])(
    "returns CONFLICT for %s; state unchanged, no audit record",
    async (_n, version) => {
      if (version === 0) {
        ok(
          await setPerUserApproval({ reference: "first", version: 0 }, ctxAt()),
        );
      }
      const before = await getPerUserApproval();
      const records0 = (await auditRecords()).length;
      expect(
        await setPerUserApproval(
          { reference: "x", version },
          ctxAt(NOW, "req-2"),
        ),
      ).toEqual({ ok: false, code: "CONFLICT" });
      expect(await getPerUserApproval()).toEqual(before);
      expect(await auditRecords()).toHaveLength(records0);
    },
  );

  it("two concurrent writers at the same version: exactly one wins (the condition is in the transaction)", async () => {
    const results = await Promise.all([
      setPerUserApproval({ reference: "a", version: 0 }, ctxAt(NOW, "req-a")),
      setPerUserApproval({ reference: "b", version: 0 }, ctxAt(NOW, "req-b")),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, code: "CONFLICT" },
    ]);
    expect(await auditRecords()).toHaveLength(1);
  });

  it("writes one failed record and rethrows on a downstream failure; nothing is stored", async () => {
    faults.transact = true;
    await expect(
      setPerUserApproval({ reference: "x", version: 0 }, ctxAt()),
    ).rejects.toThrow();
    faults.transact = false;
    expect(await getPerUserApproval()).toBeNull();
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "governance.approval.update",
      result: "failed",
    });
  });
});
