import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("./access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  ACTOR,
  CURSOR_SECRET,
  NOW,
  OID_A,
  OID_B,
  auditRecords,
  collectPages,
  ctxAt,
  faults,
  ok,
  resetFaults,
} from "./access-test-support";
import { grantRole, listRoleGrants, revokeRole } from "./role-grants";

// Source: docs/specs/2026-11-10-access-control.md — "Audit log" (role.grant and
// role.revoke are security events), role grants in "Data model additions";
// contract R2 §2-§4, addendum B.4/B.6. Assumed API:
// listRoleGrants({ cursorSecret, cursor?, limit? }) → AccessResult<{ items, cursor? }>.
const ctx = ctxAt();
const opts = { cursorSecret: CURSOR_SECRET };

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("grantRole", () => {
  it("creates the grant and one role.grant security record", async () => {
    const grant = ok(
      await grantRole(
        { oid: OID_A, role: "internal-admin", reason: "break-glass cover" },
        ctx,
      ),
    );
    expect(grant).toMatchObject({
      oid: OID_A,
      role: "internal-admin",
      reason: "break-glass cover",
      grantedBy: ACTOR,
      grantedAt: NOW.toISOString(),
      version: 1,
    });
    expect(ok(await listRoleGrants(opts)).items).toEqual([grant]);
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "role.grant",
      category: "security",
      result: "success",
    });
  });

  it("returns CONFLICT for an existing grant of that role, no record", async () => {
    const input = { oid: OID_A, role: "internal-admin", reason: "x" } as const;
    ok(await grantRole(input, ctx));
    expect(await grantRole(input, ctxAt(NOW, "req-2"))).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await auditRecords()).toHaveLength(1);
  });

  it("two grants sharing one context leave two distinct records", async () => {
    const shared = ctxAt(NOW, "req-shared");
    ok(
      await grantRole(
        { oid: OID_A, role: "internal-admin", reason: "a" },
        shared,
      ),
    );
    ok(
      await grantRole(
        { oid: OID_B, role: "internal-admin", reason: "b" },
        shared,
      ),
    );
    expect(await auditRecords()).toHaveLength(2);
  });

  it("a success then an injected failure on one context keeps both records", async () => {
    const shared = ctxAt(NOW, "req-shared");
    ok(
      await grantRole(
        { oid: OID_A, role: "internal-admin", reason: "a" },
        shared,
      ),
    );
    faults.transact = true;
    await expect(
      grantRole({ oid: OID_B, role: "internal-admin", reason: "b" }, shared),
    ).rejects.toThrow();
    faults.transact = false;
    expect((await auditRecords()).map((r) => r.result).sort()).toEqual([
      "failed",
      "success",
    ]);
  });

  it("allows different roles for one person", async () => {
    ok(
      await grantRole({ oid: OID_A, role: "internal-admin", reason: "a" }, ctx),
    );
    ok(
      await grantRole(
        { oid: OID_A, role: "internal-org-admin", reason: "b" },
        ctxAt(NOW, "req-2"),
      ),
    );
    expect(ok(await listRoleGrants(opts)).items).toHaveLength(2);
  });

  it("writes one failed record and rethrows on a downstream failure", async () => {
    faults.transact = true;
    await expect(
      grantRole({ oid: OID_A, role: "internal-admin", reason: "x" }, ctx),
    ).rejects.toThrow();
    faults.transact = false;
    expect(ok(await listRoleGrants(opts)).items).toEqual([]);
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "role.grant",
      category: "security",
      result: "failed",
    });
  });
});

describe("revokeRole", () => {
  it("removes the grant and writes one role.revoke security record", async () => {
    const grant = ok(
      await grantRole({ oid: OID_A, role: "internal-admin", reason: "x" }, ctx),
    );
    expect(
      await revokeRole(
        { oid: OID_A, role: "internal-admin", version: grant.version },
        ctxAt(NOW, "req-2"),
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(ok(await listRoleGrants(opts)).items).toEqual([]);
    const records = await auditRecords();
    expect(records.map((r) => r.action)).toEqual(["role.grant", "role.revoke"]);
    expect(records[1]?.category).toBe("security");
  });

  it("returns CONFLICT on a stale version and NOT_FOUND when missing, no record", async () => {
    const grant = ok(
      await grantRole({ oid: OID_A, role: "internal-admin", reason: "x" }, ctx),
    );
    const r2 = ctxAt(NOW, "req-2");
    expect(
      await revokeRole(
        { oid: OID_A, role: "internal-admin", version: grant.version + 1 },
        r2,
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(
      await revokeRole({ oid: OID_B, role: "internal-admin", version: 1 }, r2),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await auditRecords()).toHaveLength(1);
  });
});

describe("listRoleGrants (Rule 20.6)", () => {
  it("pages across all people with an opaque cursor", async () => {
    const oids = Array.from(
      { length: 5 },
      (_, i) => `00000000-0000-4000-8000-0000000002${i}0`,
    );
    for (const oid of oids) {
      ok(await grantRole({ oid, role: "internal-admin", reason: "r" }, ctx));
    }
    const all = await collectPages((cursor) =>
      listRoleGrants({ ...opts, limit: 2, cursor }),
    );
    expect(all.pages).toBeGreaterThanOrEqual(3);
    expect(all.items.map((g) => g.oid).sort()).toEqual([...oids].sort());
  });

  it("returns BAD_CURSOR for a tampered cursor", async () => {
    for (const oid of [OID_A, OID_B]) {
      ok(await grantRole({ oid, role: "internal-admin", reason: "r" }, ctx));
    }
    const cursor = ok(await listRoleGrants({ ...opts, limit: 1 })).cursor;
    expect(cursor).toBeDefined();
    expect(await listRoleGrants({ ...opts, cursor: `${cursor}x` })).toEqual({
      ok: false,
      code: "BAD_CURSOR",
    });
  });
});
