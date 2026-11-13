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
  seedSsoAffiliation,
} from "./access-test-support";
import { grantAdminScope, listAdminScopes } from "./admin-scopes";
import {
  addMember,
  getAffiliation,
  listTeamMembers,
  moveMember,
  removeMember,
} from "./affiliations";

// Source: docs/specs/2026-11-10-access-control.md — "Membership, admin scopes
// and lifecycle" (Joiner/Mover/Leaver), "Audit log" semantics, threats T9
// (move removes the source team scope) and T18; contract R2 §3-§4 and
// addendum B.4, B.6. Behaviour only — no raw item reads (D26.5).
// Assumed API: listTeamMembers(teamId, { cursorSecret, cursor?, limit? }) →
// AccessResult<{ items: MemberAffiliation[]; cursor?: string }>.
const ctx = ctxAt();

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("addMember", () => {
  it("creates a ui affiliation and exactly one affiliation.add record", async () => {
    const value = ok(await addMember({ oid: OID_A, teamId: "t1" }, ctx));
    expect(value).toMatchObject({
      oid: OID_A,
      teamId: "t1",
      source: "ui",
      version: 1,
      createdBy: ACTOR,
    });
    expect(await getAffiliation(OID_A)).toEqual(value);
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "affiliation.add",
      category: "change",
      result: "success",
      actor: ACTOR,
      requestId: "req-1",
      teamId: "t1",
    });
  });

  it("returns ALREADY_AFFILIATED and writes no record when already a member", async () => {
    ok(await addMember({ oid: OID_A, teamId: "t1" }, ctx));
    const before = (await auditRecords()).length;
    expect(await addMember({ oid: OID_A, teamId: "t2" }, ctx)).toEqual({
      ok: false,
      code: "ALREADY_AFFILIATED",
    });
    expect((await getAffiliation(OID_A))?.teamId).toBe("t1");
    expect(await auditRecords()).toHaveLength(before);
  });

  it("writes one failed record, no affiliation, and rethrows on a downstream failure", async () => {
    faults.transact = true;
    await expect(
      addMember({ oid: OID_A, teamId: "t1" }, ctx),
    ).rejects.toThrow();
    faults.transact = false;
    expect(await getAffiliation(OID_A)).toBeNull();
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "affiliation.add",
      result: "failed",
      actor: ACTOR,
    });
  });
});

describe("audit index per request (T18, T19)", () => {
  it("two calls sharing one context leave two distinct records", async () => {
    const shared = ctxAt(NOW, "req-shared");
    ok(await addMember({ oid: OID_A, teamId: "t1" }, shared));
    ok(await addMember({ oid: OID_B, teamId: "t1" }, shared));
    const records = await auditRecords();
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.requestId)).toEqual([
      "req-shared",
      "req-shared",
    ]);
  });

  it("a success followed by a downstream failure on the same context keeps both records", async () => {
    const shared = ctxAt(NOW, "req-shared");
    ok(await addMember({ oid: OID_A, teamId: "t1" }, shared));
    faults.transact = true;
    await expect(
      addMember({ oid: OID_B, teamId: "t1" }, shared),
    ).rejects.toThrow();
    faults.transact = false;
    const records = await auditRecords();
    expect(records.map((r) => r.result).sort()).toEqual(["failed", "success"]);
  });
});

describe("getAffiliation", () => {
  it("returns null when none exists", async () => {
    expect(await getAffiliation(OID_A)).toBeNull();
  });
});

describe("removeMember", () => {
  it("removes the affiliation and writes one affiliation.remove record", async () => {
    const a = ok(await addMember({ oid: OID_A, teamId: "t1" }, ctx));
    expect(
      await removeMember(
        { oid: OID_A, teamId: "t1", version: a.version },
        ctxAt(NOW, "req-2"),
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(await getAffiliation(OID_A)).toBeNull();
    const actions = (await auditRecords()).map((r) => r.action);
    expect(actions).toEqual(["affiliation.add", "affiliation.remove"]);
  });

  it("returns CONFLICT for a stale version and writes no record", async () => {
    const a = ok(await addMember({ oid: OID_A, teamId: "t1" }, ctx));
    expect(
      await removeMember(
        { oid: OID_A, teamId: "t1", version: a.version + 1 },
        ctxAt(NOW, "req-2"),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await getAffiliation(OID_A)).not.toBeNull();
    expect(await auditRecords()).toHaveLength(1);
  });

  it("returns NOT_FOUND for a missing affiliation or another team's, with no record", async () => {
    expect(
      await removeMember({ oid: OID_A, teamId: "t1", version: 1 }, ctx),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    const a = ok(await addMember({ oid: OID_B, teamId: "t1" }, ctx));
    expect(
      await removeMember(
        { oid: OID_B, teamId: "t2", version: a.version },
        ctxAt(NOW, "req-2"),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await auditRecords()).toHaveLength(1);
  });

  it("returns MANAGED_BY_SSO for an sso-sourced affiliation and writes no record", async () => {
    await seedSsoAffiliation(OID_A, "t1");
    expect(
      await removeMember({ oid: OID_A, teamId: "t1", version: 1 }, ctx),
    ).toEqual({ ok: false, code: "MANAGED_BY_SSO" });
    expect((await getAffiliation(OID_A))?.source).toBe("sso");
    expect(await auditRecords()).toHaveLength(0);
  });

  it("writes one failed record and rethrows on a downstream failure", async () => {
    const a = ok(await addMember({ oid: OID_A, teamId: "t1" }, ctx));
    faults.transact = true;
    await expect(
      removeMember(
        { oid: OID_A, teamId: "t1", version: a.version },
        ctxAt(NOW, "req-2"),
      ),
    ).rejects.toThrow();
    faults.transact = false;
    expect(await getAffiliation(OID_A)).not.toBeNull();
    const failed = (await auditRecords()).filter((r) => r.result === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.action).toBe("affiliation.remove");
  });
});

describe("moveMember (T9)", () => {
  it("moves the affiliation and writes exactly one affiliation.move record", async () => {
    const a = ok(await addMember({ oid: OID_A, teamId: "t1" }, ctx));
    const moved = ok(
      await moveMember(
        { oid: OID_A, fromTeamId: "t1", toTeamId: "t2", version: a.version },
        ctxAt(NOW, "req-2"),
      ),
    );
    expect(moved).toMatchObject({ oid: OID_A, teamId: "t2", source: "ui" });
    expect(moved.version).toBeGreaterThan(a.version);
    expect(await getAffiliation(OID_A)).toEqual(moved);
    const records = await auditRecords();
    expect(records.map((r) => r.action)).toEqual([
      "affiliation.add",
      "affiliation.move",
    ]);
    expect(records[1]).toMatchObject({ result: "success", requestId: "req-2" });
  });

  it("removes ADMINSCOPE#TEAM#{from} in the same transaction, recorded in the single move record", async () => {
    const a = ok(await addMember({ oid: OID_A, teamId: "t1" }, ctx));
    ok(
      await grantAdminScope(
        { oid: OID_A, scopeType: "team", scopeId: "t1" },
        ctxAt(NOW, "req-2"),
      ),
    );
    ok(
      await grantAdminScope(
        { oid: OID_A, scopeType: "team", scopeId: "t9" },
        ctxAt(NOW, "req-3"),
      ),
    );
    ok(
      await moveMember(
        { oid: OID_A, fromTeamId: "t1", toTeamId: "t2", version: a.version },
        ctxAt(NOW, "req-4"),
      ),
    );
    const scopes = ok(
      await listAdminScopes(OID_A, { cursorSecret: CURSOR_SECRET }),
    ).items;
    expect(scopes.map((s) => s.scopeId)).toEqual(["t9"]);
    const atMove = (await auditRecords()).filter(
      (r) => r.requestId === "req-4",
    );
    expect(atMove).toHaveLength(1);
    expect(atMove[0]).toMatchObject({ action: "affiliation.move" });
    expect(atMove[0]?.before).toHaveProperty("removedAdminScope");
  });

  it("returns CONFLICT for a stale version and changes nothing", async () => {
    const a = ok(await addMember({ oid: OID_A, teamId: "t1" }, ctx));
    expect(
      await moveMember(
        {
          oid: OID_A,
          fromTeamId: "t1",
          toTeamId: "t2",
          version: a.version + 5,
        },
        ctxAt(NOW, "req-2"),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect((await getAffiliation(OID_A))?.teamId).toBe("t1");
    expect(await auditRecords()).toHaveLength(1);
  });

  it("returns MANAGED_BY_SSO for an sso-sourced affiliation", async () => {
    await seedSsoAffiliation(OID_A, "t1");
    expect(
      await moveMember(
        { oid: OID_A, fromTeamId: "t1", toTeamId: "t2", version: 1 },
        ctx,
      ),
    ).toEqual({ ok: false, code: "MANAGED_BY_SSO" });
    expect((await getAffiliation(OID_A))?.teamId).toBe("t1");
    expect(await auditRecords()).toHaveLength(0);
  });

  it("returns NOT_FOUND when the member is not in the from-team", async () => {
    ok(await addMember({ oid: OID_A, teamId: "t1" }, ctx));
    expect(
      await moveMember(
        { oid: OID_A, fromTeamId: "t7", toTeamId: "t2", version: 1 },
        ctxAt(NOW, "req-2"),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await auditRecords()).toHaveLength(1);
  });

  it("is atomic: a failing transaction leaves affiliation and scope untouched, one failed record", async () => {
    const a = ok(await addMember({ oid: OID_A, teamId: "t1" }, ctx));
    ok(
      await grantAdminScope(
        { oid: OID_A, scopeType: "team", scopeId: "t1" },
        ctxAt(NOW, "req-2"),
      ),
    );
    faults.transact = true;
    await expect(
      moveMember(
        { oid: OID_A, fromTeamId: "t1", toTeamId: "t2", version: a.version },
        ctxAt(NOW, "req-3"),
      ),
    ).rejects.toThrow();
    faults.transact = false;
    expect((await getAffiliation(OID_A))?.teamId).toBe("t1");
    expect(
      ok(await listAdminScopes(OID_A, { cursorSecret: CURSOR_SECRET })).items,
    ).toHaveLength(1);
    const failed = (await auditRecords()).filter((r) => r.result === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ action: "affiliation.move" });
  });
});

describe("listTeamMembers (Rule 20.6 pagination)", () => {
  const oids = Array.from(
    { length: 5 },
    (_, i) => `00000000-0000-4000-8000-0000000001${i}0`,
  );

  it("returns only the team's members, paging with an opaque cursor", async () => {
    for (const oid of oids) ok(await addMember({ oid, teamId: "t1" }, ctx));
    ok(await addMember({ oid: OID_B, teamId: "t2" }, ctx));
    const first = ok(
      await listTeamMembers("t1", { cursorSecret: CURSOR_SECRET, limit: 2 }),
    );
    expect(first.items.length).toBeLessThanOrEqual(2);
    expect(first.cursor).toEqual(expect.any(String));
    const all = await collectPages((cursor) =>
      listTeamMembers("t1", { cursorSecret: CURSOR_SECRET, limit: 2, cursor }),
    );
    expect(all.pages).toBeGreaterThanOrEqual(3);
    expect(all.items.map((m) => m.oid).sort()).toEqual([...oids].sort());
  });

  it("omits cursor on a final page and returns an empty page for an unknown team", async () => {
    const page = ok(
      await listTeamMembers("none", { cursorSecret: CURSOR_SECRET }),
    );
    expect(page).toEqual({ items: [] });
  });

  it("returns BAD_CURSOR when a team's cursor is replayed against another team", async () => {
    for (const oid of oids) ok(await addMember({ oid, teamId: "t1" }, ctx));
    for (const oid of [OID_A, OID_B]) {
      ok(await addMember({ oid, teamId: "t2" }, ctx));
    }
    const cursor = ok(
      await listTeamMembers("t1", { cursorSecret: CURSOR_SECRET, limit: 2 }),
    ).cursor;
    expect(cursor).toBeDefined();
    expect(
      await listTeamMembers("t2", { cursorSecret: CURSOR_SECRET, cursor }),
    ).toEqual({ ok: false, code: "BAD_CURSOR" });
  });

  it("returns BAD_CURSOR for a tampered or foreign-secret cursor", async () => {
    for (const oid of oids) ok(await addMember({ oid, teamId: "t1" }, ctx));
    const first = ok(
      await listTeamMembers("t1", { cursorSecret: CURSOR_SECRET, limit: 2 }),
    );
    const cursor = first.cursor ?? "";
    expect(
      await listTeamMembers("t1", {
        cursorSecret: "other-test-cursor-secret",
        cursor,
      }),
    ).toEqual({ ok: false, code: "BAD_CURSOR" });
    expect(
      await listTeamMembers("t1", {
        cursorSecret: CURSOR_SECRET,
        cursor: `x${cursor}`,
      }),
    ).toEqual({ ok: false, code: "BAD_CURSOR" });
  });
});
