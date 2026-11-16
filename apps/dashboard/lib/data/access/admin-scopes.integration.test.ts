import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/support/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/test/support/access-test-support").then((m) => m.faultyDynamodb()),
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
  seedSsoAdminScope,
} from "@/test/support/access-test-support";
import {
  grantAdminScope,
  listAdminScopes,
  listScopeAdmins,
  revokeAdminScope,
} from "./admin-scopes";

// Source: docs/specs/2026-11-10-access-control.md — "Membership, admin scopes
// and lifecycle", "Audit log"; contract R2 §3-§4, addendum B.4/B.6.
// Assumed API: listAdminScopes(oid, opts) and listScopeAdmins(ref, opts) with
// opts = { cursorSecret, cursor?, limit? } → AccessResult<{ items, cursor? }>.
const ctx = ctxAt();
const opts = { cursorSecret: CURSOR_SECRET };
const team = (oid: string, id: string) =>
  ({ oid, scopeType: "team", scopeId: id }) as const;

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("grantAdminScope", () => {
  it("creates a ui scope and writes one adminscope.grant record", async () => {
    const scope = ok(await grantAdminScope(team(OID_A, "t1"), ctx));
    expect(scope).toMatchObject({
      oid: OID_A,
      scopeType: "team",
      scopeId: "t1",
      source: "ui",
      version: 1,
      createdBy: ACTOR,
    });
    expect(ok(await listAdminScopes(OID_A, opts)).items).toEqual([scope]);
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "adminscope.grant",
      category: "change",
      result: "success",
    });
  });

  it("supports department scopes", async () => {
    ok(
      await grantAdminScope(
        { oid: OID_A, scopeType: "department", scopeId: "d1" },
        ctx,
      ),
    );
    expect(ok(await listAdminScopes(OID_A, opts)).items[0]).toMatchObject({
      scopeType: "department",
      scopeId: "d1",
    });
  });

  it("returns CONFLICT for an existing scope and writes no record", async () => {
    ok(await grantAdminScope(team(OID_A, "t1"), ctx));
    expect(
      await grantAdminScope(team(OID_A, "t1"), ctxAt(NOW, "req-2")),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await auditRecords()).toHaveLength(1);
  });

  it("writes one failed record and rethrows on a downstream failure", async () => {
    faults.transact = true;
    await expect(grantAdminScope(team(OID_A, "t1"), ctx)).rejects.toThrow();
    faults.transact = false;
    expect(ok(await listAdminScopes(OID_A, opts)).items).toEqual([]);
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "adminscope.grant",
      result: "failed",
    });
  });
});

describe("revokeAdminScope", () => {
  it("removes the scope and writes one adminscope.revoke record", async () => {
    const scope = ok(await grantAdminScope(team(OID_A, "t1"), ctx));
    expect(
      await revokeAdminScope(
        { ...team(OID_A, "t1"), version: scope.version },
        ctxAt(NOW, "req-2"),
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(ok(await listAdminScopes(OID_A, opts)).items).toEqual([]);
    expect((await auditRecords()).map((r) => r.action)).toEqual([
      "adminscope.grant",
      "adminscope.revoke",
    ]);
  });

  it("returns CONFLICT on a stale version, NOT_FOUND when missing, MANAGED_BY_SSO for sso — none writes a record", async () => {
    const scope = ok(await grantAdminScope(team(OID_A, "t1"), ctx));
    const r2 = ctxAt(NOW, "req-2");
    expect(
      await revokeAdminScope(
        { ...team(OID_A, "t1"), version: scope.version + 1 },
        r2,
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(
      await revokeAdminScope({ ...team(OID_A, "nope"), version: 1 }, r2),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    await seedSsoAdminScope(OID_B, "team", "t1");
    expect(
      await revokeAdminScope({ ...team(OID_B, "t1"), version: 1 }, r2),
    ).toEqual({ ok: false, code: "MANAGED_BY_SSO" });
    expect(await auditRecords()).toHaveLength(1);
  });

  it("writes one failed record and rethrows on a downstream failure", async () => {
    const scope = ok(await grantAdminScope(team(OID_A, "t1"), ctx));
    faults.transact = true;
    await expect(
      revokeAdminScope(
        { ...team(OID_A, "t1"), version: scope.version },
        ctxAt(NOW, "req-2"),
      ),
    ).rejects.toThrow();
    faults.transact = false;
    expect(ok(await listAdminScopes(OID_A, opts)).items).toHaveLength(1);
    const failed = (await auditRecords()).filter((r) => r.result === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.action).toBe("adminscope.revoke");
  });
});

describe("listAdminScopes and listScopeAdmins (Rule 20.6)", () => {
  it("pages a person's scopes with an opaque cursor", async () => {
    for (const id of ["t1", "t2", "t3", "t4", "t5"]) {
      ok(await grantAdminScope(team(OID_A, id), ctx));
    }
    ok(await grantAdminScope(team(OID_B, "t1"), ctx));
    const first = ok(await listAdminScopes(OID_A, { ...opts, limit: 2 }));
    expect(first.items.length).toBeLessThanOrEqual(2);
    expect(first.cursor).toEqual(expect.any(String));
    const all = await collectPages((cursor) =>
      listAdminScopes(OID_A, { ...opts, limit: 2, cursor }),
    );
    expect(all.pages).toBeGreaterThanOrEqual(3);
    expect(all.items.map((s) => s.scopeId).sort()).toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
    ]);
  });

  it("lists the admins of a scope across people, paging", async () => {
    const oids = ["a1", "a2", "a3", "a4"].map(
      (s) => `00000000-0000-4000-8000-00000000${s}00`,
    );
    for (const oid of oids) ok(await grantAdminScope(team(oid, "t1"), ctx));
    ok(await grantAdminScope(team(OID_A, "t2"), ctx));
    const all = await collectPages((cursor) =>
      listScopeAdmins(
        { scopeType: "team", scopeId: "t1" },
        { ...opts, limit: 2, cursor },
      ),
    );
    expect(all.pages).toBeGreaterThanOrEqual(2);
    expect(all.items.map((s) => s.oid).sort()).toEqual([...oids].sort());
  });

  it("returns BAD_CURSOR when a cursor is replayed against another person or scope", async () => {
    for (const id of ["t1", "t2", "t3"]) {
      ok(await grantAdminScope(team(OID_A, id), ctx));
      ok(await grantAdminScope(team(OID_B, id), ctx));
    }
    const mine = ok(await listAdminScopes(OID_A, { ...opts, limit: 1 })).cursor;
    expect(mine).toBeDefined();
    expect(await listAdminScopes(OID_B, { ...opts, cursor: mine })).toEqual({
      ok: false,
      code: "BAD_CURSOR",
    });
    const t1 = ok(
      await listScopeAdmins(
        { scopeType: "team", scopeId: "t1" },
        { ...opts, limit: 1 },
      ),
    ).cursor;
    expect(t1).toBeDefined();
    expect(
      await listScopeAdmins(
        { scopeType: "team", scopeId: "t2" },
        { ...opts, cursor: t1 },
      ),
    ).toEqual({ ok: false, code: "BAD_CURSOR" });
  });

  it("returns BAD_CURSOR for a tampered cursor", async () => {
    for (const id of ["t1", "t2", "t3"]) {
      ok(await grantAdminScope(team(OID_A, id), ctx));
    }
    const cursor = ok(
      await listAdminScopes(OID_A, { ...opts, limit: 1 }),
    ).cursor;
    expect(cursor).toBeDefined();
    expect(
      await listAdminScopes(OID_A, { ...opts, cursor: `${cursor}x` }),
    ).toEqual({ ok: false, code: "BAD_CURSOR" });
    expect(
      await listAdminScopes(OID_A, {
        cursorSecret: "other-test-cursor-secret",
        cursor,
      }),
    ).toEqual({ ok: false, code: "BAD_CURSOR" });
  });
});
