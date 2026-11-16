import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/support/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/test/support/access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  CURSOR_SECRET,
  NOW,
  auditRecords,
  collectPages,
  ctxAt,
  faults,
  ok,
  resetFaults,
} from "@/test/support/access-test-support";
import {
  createGroupMapping,
  deleteGroupMapping,
  listGroupMappings,
  updateGroupMapping,
} from "./group-mappings";

// Source: docs/specs/2026-11-10-access-control.md — "Identity, SSO mapping and
// defaults" (group mappings grant scoped roles only, never a global one; T4),
// "Audit log" (groupmap.* are change records, one per write, in the same
// transaction; a 409 writes none); contract R2 §3 `group-mappings` with the
// R2a list convention (opts -> AccessResult<{ items, cursor? }>).
const opts = { cursorSecret: CURSOR_SECRET };
const member = (groupId: string, teamId = "team-payments") =>
  ({
    groupId,
    target: { type: "team", id: teamId },
    scopedRole: "member",
  }) as const;

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("createGroupMapping", () => {
  it("stores the mapping and writes one groupmap.create change record", async () => {
    const created = ok(await createGroupMapping(member("g-1"), ctxAt()));
    expect(created).toMatchObject({
      groupId: "g-1",
      target: { type: "team", id: "team-payments" },
      scopedRole: "member",
      version: 1,
      updatedAt: NOW.toISOString(),
    });
    expect(ok(await listGroupMappings(opts)).items).toEqual([created]);
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "groupmap.create",
      category: "change",
      result: "success",
      target: { type: "groupmap", id: "g-1" },
    });
  });

  it("returns CONFLICT for an existing group id and writes no second record", async () => {
    ok(await createGroupMapping(member("g-1"), ctxAt()));
    expect(
      await createGroupMapping(member("g-1", "team-other"), ctxAt(NOW, "r2")),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await auditRecords()).toHaveLength(1);
  });

  it("accepts an internal-team-admin mapping onto a department", async () => {
    const created = ok(
      await createGroupMapping(
        {
          groupId: "g-admin",
          target: { type: "department", id: "dept-eng" },
          scopedRole: "internal-team-admin",
        },
        ctxAt(),
      ),
    );
    expect(created.scopedRole).toBe("internal-team-admin");
  });

  it("rejects a mapping that targets a global role and stores nothing (T4)", async () => {
    await expect(
      createGroupMapping(
        {
          groupId: "g-bad",
          target: { type: "team", id: "t" },
          scopedRole: "internal-admin",
        } as never,
        ctxAt(),
      ),
    ).rejects.toThrow();
    expect(ok(await listGroupMappings(opts)).items).toEqual([]);
    expect(await auditRecords()).toEqual([]);
  });

  it("rejects the member role on a department target", async () => {
    await expect(
      createGroupMapping(
        {
          groupId: "g-bad",
          target: { type: "department", id: "d" },
          scopedRole: "member",
        },
        ctxAt(),
      ),
    ).rejects.toThrow();
    expect(ok(await listGroupMappings(opts)).items).toEqual([]);
  });

  it("writes one failed record and rethrows when the transaction fails", async () => {
    faults.transact = true;
    await expect(createGroupMapping(member("g-1"), ctxAt())).rejects.toThrow();
    faults.transact = false;
    expect(ok(await listGroupMappings(opts)).items).toEqual([]);
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "groupmap.create",
      result: "failed",
    });
  });
});

describe("updateGroupMapping", () => {
  it("changes the target, bumps the version and writes one groupmap.update record", async () => {
    const created = ok(await createGroupMapping(member("g-1"), ctxAt()));
    const updated = ok(
      await updateGroupMapping(
        { ...member("g-1", "team-new"), version: created.version },
        ctxAt(NOW, "r2"),
      ),
    );
    expect(updated).toMatchObject({
      target: { type: "team", id: "team-new" },
      version: created.version + 1,
    });
    expect(ok(await listGroupMappings(opts)).items).toEqual([updated]);
    const actions = (await auditRecords()).map((r) => r.action);
    expect(actions.sort()).toEqual(["groupmap.create", "groupmap.update"]);
  });

  it("returns CONFLICT for a stale version and writes no record", async () => {
    const created = ok(await createGroupMapping(member("g-1"), ctxAt()));
    ok(
      await updateGroupMapping(
        { ...member("g-1", "team-b"), version: created.version },
        ctxAt(NOW, "r2"),
      ),
    );
    expect(
      await updateGroupMapping(
        { ...member("g-1", "team-c"), version: created.version },
        ctxAt(NOW, "r3"),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await auditRecords()).toHaveLength(2);
  });

  it("returns NOT_FOUND for a missing mapping and writes no record", async () => {
    expect(
      await updateGroupMapping({ ...member("ghost"), version: 1 }, ctxAt()),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await auditRecords()).toEqual([]);
  });

  it("rejects an update that switches to a global role", async () => {
    const created = ok(await createGroupMapping(member("g-1"), ctxAt()));
    await expect(
      updateGroupMapping(
        {
          ...member("g-1"),
          scopedRole: "internal-org-admin",
          version: created.version,
        } as never,
        ctxAt(NOW, "r2"),
      ),
    ).rejects.toThrow();
    expect(ok(await listGroupMappings(opts)).items).toEqual([created]);
  });
});

describe("deleteGroupMapping", () => {
  it("removes the mapping and writes one groupmap.delete record", async () => {
    const created = ok(await createGroupMapping(member("g-1"), ctxAt()));
    ok(
      await deleteGroupMapping(
        { groupId: "g-1", version: created.version },
        ctxAt(NOW, "r2"),
      ),
    );
    expect(ok(await listGroupMappings(opts)).items).toEqual([]);
    const actions = (await auditRecords()).map((r) => r.action);
    expect(actions.sort()).toEqual(["groupmap.create", "groupmap.delete"]);
  });

  it("returns CONFLICT for a stale version, NOT_FOUND for a missing mapping, no record", async () => {
    ok(await createGroupMapping(member("g-1"), ctxAt()));
    expect(
      await deleteGroupMapping(
        { groupId: "g-1", version: 99 },
        ctxAt(NOW, "r2"),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(
      await deleteGroupMapping(
        { groupId: "nope", version: 1 },
        ctxAt(NOW, "r3"),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await auditRecords()).toHaveLength(1);
  });
});

describe("listGroupMappings", () => {
  it("returns an empty page when there are no mappings", async () => {
    expect(ok(await listGroupMappings(opts)).items).toEqual([]);
  });

  it("paginates with an opaque cursor and returns every mapping once (Rule 20.6)", async () => {
    const shared = ctxAt(NOW, "r-many");
    for (let i = 0; i < 5; i += 1) {
      ok(await createGroupMapping(member(`g-${i}`), shared));
    }
    const { items, pages } = await collectPages((cursor) =>
      listGroupMappings({ ...opts, limit: 2, ...(cursor ? { cursor } : {}) }),
    );
    expect(pages).toBeGreaterThan(1);
    expect(items.map((m) => m.groupId).sort()).toEqual([
      "g-0",
      "g-1",
      "g-2",
      "g-3",
      "g-4",
    ]);
  });

  it("rejects a tampered cursor with BAD_CURSOR", async () => {
    const shared = ctxAt(NOW, "r-many");
    for (let i = 0; i < 3; i += 1) {
      ok(await createGroupMapping(member(`g-${i}`), shared));
    }
    const first = ok(await listGroupMappings({ ...opts, limit: 1 }));
    expect(first.cursor).toBeDefined();
    expect(
      await listGroupMappings({
        ...opts,
        limit: 1,
        cursor: `${first.cursor}x`,
      }),
    ).toEqual({ ok: false, code: "BAD_CURSOR" });
  });
});
