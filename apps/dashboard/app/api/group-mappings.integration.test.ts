import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CURSOR_SECRET,
  ctxAt,
  ok,
} from "@/lib/data/access/access-test-support";
import { resetDeniedAudit } from "@/lib/data/access/audit";
import {
  createGroupMapping,
  listGroupMappings,
} from "@/lib/data/access/group-mappings";
import {
  expectData,
  expectError,
  auditToday,
  deniedToday,
  invoke,
  nonAuditItems,
  signInAs,
} from "@/test/governance-route-support";
import { clearTable, ensureTestTable } from "@/test/test-support";

import { DELETE, PATCH } from "./group-mappings/[groupId]/route";
import { GET, POST } from "./group-mappings/route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/group-mappings: GET internal-admin or internal-auditor; POST, PATCH,
// DELETE internal-admin), "Enforcement" items 2 (403 before parsing), 4
// (private, no-store), 6 (Zod, version -> 409, same-origin, JSON content
// type, body id equals path id -> 400), "Audit log" (one success record per
// write; a 409, 400 or 404 writes none; one `denied` record per authorization
// refusal with a fixed route pattern, D17/T22), threat T4 (a mapping never
// grants a global role), T15 (identical 404 bodies). Spec: Access Control "API routes (additions)". Only `@/auth` is mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const LIST = "/api/group-mappings";
const item = (groupId: string) => `/api/group-mappings/${groupId}`;
const mapping = (groupId: string, teamId = "team-payments") => ({
  groupId,
  target: { type: "team", id: teamId },
  scopedRole: "member",
});

// A distinct request id per seed keeps each audit key unique.
let seedCount = 0;
async function seed(groupId: string, teamId = "team-payments") {
  return ok(
    await createGroupMapping(
      mapping(groupId, teamId) as never,
      ctxAt(undefined, `req-seed-${++seedCount}`),
    ),
  );
}

type Row = { groupId: string; version: number; scopedRole: string };
const stored = async () =>
  ok(await listGroupMappings({ cursorSecret: CURSOR_SECRET })).items;

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  signInAs("admin");
});

describe("GET /api/group-mappings", () => {
  it.each(["viewer", "orgAdmin", "noRoles"] as const)(
    "403 FORBIDDEN for %s, with no data in the body",
    async (caller) => {
      await seed("g-1");
      signInAs(caller);
      const res = await invoke(GET, { method: "GET", path: LIST });
      await expectError(res, 403, "FORBIDDEN");
    },
  );

  it.each(["admin", "auditor"] as const)(
    "%s lists the mappings as { data: { items } } with no-store",
    async (caller) => {
      const created = await seed("g-1");
      signInAs(caller);
      const data = await expectData<{ items: Row[]; cursor?: string }>(
        await invoke(GET, { method: "GET", path: LIST }),
      );
      expect(data.items).toEqual([created]);
      expect(data.cursor).toBeUndefined();
    },
  );

  it("an empty list is 200 with no items", async () => {
    const data = await expectData<{ items: Row[] }>(
      await invoke(GET, { method: "GET", path: LIST }),
    );
    expect(data.items).toEqual([]);
  });

  it("paginates with ?limit and an opaque cursor, following it to the end", async () => {
    await seed("g-1");
    await seed("g-2");
    await seed("g-3");
    const first = await expectData<{ items: Row[]; cursor?: string }>(
      await invoke(GET, { method: "GET", path: `${LIST}?limit=2` }),
    );
    expect(first.items).toHaveLength(2);
    expect(typeof first.cursor).toBe("string");
    // The cursor is opaque: never a raw DynamoDB LastEvaluatedKey.
    expect(first.cursor).not.toContain("GROUPMAP#");
    const second = await expectData<{ items: Row[]; cursor?: string }>(
      await invoke(GET, {
        method: "GET",
        path: `${LIST}?limit=2&cursor=${encodeURIComponent(first.cursor!)}`,
      }),
    );
    expect(second.items).toHaveLength(1);
    expect(second.cursor).toBeUndefined();
    const ids = [...first.items, ...second.items].map((r) => r.groupId).sort();
    expect(ids).toEqual(["g-1", "g-2", "g-3"]);
  });

  it.each([
    ["a tampered cursor", "limit=2&cursor=not-a-real-cursor"],
    ["a zero limit", "limit=0"],
    ["a non-numeric limit", "limit=abc"],
    ["a negative limit", "limit=-1"],
  ])("400 BAD_REQUEST for %s (never BAD_CURSOR)", async (_name, query) => {
    await seed("g-1");
    const body = await expectError(
      await invoke(GET, { method: "GET", path: `${LIST}?${query}` }),
      400,
      "BAD_REQUEST",
    );
    expect(body.error.code).not.toBe("BAD_CURSOR");
  });
});

describe("POST /api/group-mappings", () => {
  it("creates a mapping (version 1), returns it and writes one groupmap.create success record", async () => {
    const data = await expectData<Row>(
      await invoke(POST, { method: "POST", path: LIST, body: mapping("g-1") }),
      [200, 201],
    );
    expect(data).toMatchObject({
      groupId: "g-1",
      target: { type: "team", id: "team-payments" },
      scopedRole: "member",
      version: 1,
    });
    expect(await stored()).toEqual([data]);
    const records = await auditToday();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "groupmap.create",
      result: "success",
      category: "change",
      actor: "oid-admin",
    });
  });

  it("409 CONFLICT for a group id that is already mapped; nothing new is audited", async () => {
    await seed("g-1");
    const before = (await auditToday()).length;
    await expectError(
      await invoke(POST, {
        method: "POST",
        path: LIST,
        body: mapping("g-1", "team-other"),
      }),
      409,
      "CONFLICT",
    );
    expect((await auditToday()).length).toBe(before);
    expect((await stored())[0]).toMatchObject({
      target: { type: "team", id: "team-payments" },
    });
  });

  it.each([
    ["no Content-Type", null],
    ["text/plain", "text/plain"],
    ["form encoded", "application/x-www-form-urlencoded"],
  ])(
    "400 BAD_REQUEST for %s; nothing is stored or audited",
    async (_name, contentType) => {
      await expectError(
        await invoke(POST, {
          method: "POST",
          path: LIST,
          body: mapping("g-1"),
          contentType,
        }),
        400,
        "BAD_REQUEST",
      );
      expect(await nonAuditItems()).toEqual([]);
      expect(await auditToday()).toEqual([]);
    },
  );

  it("accepts application/json with a charset parameter", async () => {
    await expectData(
      await invoke(POST, {
        method: "POST",
        path: LIST,
        body: mapping("g-1"),
        contentType: "application/json; charset=utf-8",
      }),
      [200, 201],
    );
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["an empty object", {}],
    ["a missing target", { groupId: "g-1", scopedRole: "member" }],
    ["an empty group id", { ...mapping("x"), groupId: "" }],
    ["a global role (T4)", { ...mapping("g-1"), scopedRole: "internal-admin" }],
    ["an unknown role", { ...mapping("g-1"), scopedRole: "superuser" }],
    [
      "member on a department",
      {
        groupId: "g-1",
        target: { type: "department", id: "dept-x" },
        scopedRole: "member",
      },
    ],
    [
      "a target type that is neither team nor department",
      { ...mapping("g-1"), target: { type: "org", id: "x" } },
    ],
    ["a non-object body", "[]"],
    [
      "a target id over 128 characters (slice-1 review warning)",
      { ...mapping("g-1"), target: { type: "team", id: "t".repeat(129) } },
    ],
  ])(
    "400 BAD_REQUEST for %s; nothing stored, no audit record",
    async (_name, body) => {
      await expectError(
        await invoke(POST, { method: "POST", path: LIST, body }),
        400,
        "BAD_REQUEST",
      );
      expect(await nonAuditItems()).toEqual([]);
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );
});

describe("PATCH /api/group-mappings/[groupId]", () => {
  const patch = (groupId: string, body: unknown, extra = {}) =>
    invoke(PATCH, {
      method: "PATCH",
      path: item(groupId),
      params: { groupId },
      body,
      ...extra,
    });
  const update = (groupId: string, version: number) => ({
    ...mapping(groupId, "team-new"),
    scopedRole: "internal-team-admin",
    version,
  });

  it("updates a mapping at the current version, bumping it, with one groupmap.update success record", async () => {
    await seed("g-1");
    const data = await expectData<Row>(await patch("g-1", update("g-1", 1)));
    expect(data).toMatchObject({
      groupId: "g-1",
      target: { type: "team", id: "team-new" },
      scopedRole: "internal-team-admin",
      version: 2,
    });
    expect(await stored()).toEqual([data]);
    const updates = (await auditToday()).filter(
      (r) => r.action === "groupmap.update",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ result: "success", actor: "oid-admin" });
  });

  it("409 CONFLICT for a stale version; the mapping is unchanged and no update is audited", async () => {
    await seed("g-1");
    await expectError(await patch("g-1", update("g-1", 5)), 409, "CONFLICT");
    expect(await stored()).toEqual([
      expect.objectContaining({ version: 1, scopedRole: "member" }),
    ]);
    expect(
      (await auditToday()).filter((r) => r.action === "groupmap.update"),
    ).toEqual([]);
  });

  it("409 CONFLICT when replaying the same version after a successful update", async () => {
    await seed("g-1");
    await expectData(await patch("g-1", update("g-1", 1)));
    await expectError(await patch("g-1", update("g-1", 1)), 409, "CONFLICT");
  });

  it("404 NOT_FOUND for an unmapped group, with a body that does not echo the id; no audit record", async () => {
    const a = await expectError(
      await patch("g-missing-a", update("g-missing-a", 1)),
      404,
      "NOT_FOUND",
    );
    const b = await expectError(
      await patch("g-missing-b", update("g-missing-b", 1)),
      404,
      "NOT_FOUND",
    );
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toContain("g-missing");
    expect(await auditToday()).toEqual([]);
  });

  it("400 for a wrong content type", async () => {
    await seed("g-1");
    await expectError(
      await patch("g-1", update("g-1", 1), { contentType: "text/plain" }),
      400,
      "BAD_REQUEST",
    );
  });

  it("400 when the body groupId differs from the path groupId; the mapping is unchanged", async () => {
    await seed("g-1");
    await seed("g-2");
    await expectError(await patch("g-1", update("g-2", 1)), 400, "BAD_REQUEST");
    expect((await stored()).every((r) => r.version === 1)).toBe(true);
  });

  it.each([
    ["a global role (T4)", { scopedRole: "internal-admin" }],
    [
      "member on a department",
      { target: { type: "department", id: "d" }, scopedRole: "member" },
    ],
    ["a missing version", { version: undefined }],
    ["a non-integer version", { version: 1.5 }],
    ["a negative version", { version: -1 }],
    ["a string version", { version: "1" }],
    [
      "a target id over 128 characters (slice-1 review warning)",
      { target: { type: "team", id: "t".repeat(129) } },
    ],
  ])("400 BAD_REQUEST for %s; no update audited", async (_name, override) => {
    await seed("g-1");
    await expectError(
      await patch("g-1", { ...update("g-1", 1), ...override }),
      400,
      "BAD_REQUEST",
    );
    expect(
      (await auditToday()).filter((r) => r.action === "groupmap.update"),
    ).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it.each(["bad id", "x".repeat(200), "g<script>", "a%2Fb", " "])(
    "400 BAD_REQUEST for a malformed path groupId %j",
    async (groupId) => {
      await seed("g-1");
      await expectError(
        await invoke(PATCH, {
          method: "PATCH",
          path: item("x"),
          params: { groupId },
          body: update(groupId, 1),
        }),
        400,
        "BAD_REQUEST",
      );
      expect(await deniedToday()).toEqual([]);
    },
  );

  it("accepts a GUID group id (an Entra group object id)", async () => {
    const guid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    await seed(guid);
    await expectData(await patch(guid, update(guid, 1)));
  });
});

describe("DELETE /api/group-mappings/[groupId]", () => {
  const del = (groupId: string, body: unknown = { version: 1 }, extra = {}) =>
    invoke(DELETE, {
      method: "DELETE",
      path: item(groupId),
      params: { groupId },
      body,
      ...extra,
    });

  it("deletes at the current version and writes one groupmap.delete success record", async () => {
    await seed("g-1");
    await expectData(await del("g-1"));
    expect(await stored()).toEqual([]);
    const deletes = (await auditToday()).filter(
      (r) => r.action === "groupmap.delete",
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatchObject({ result: "success", actor: "oid-admin" });
  });

  it("409 CONFLICT for a stale version; the mapping remains and nothing is audited", async () => {
    await seed("g-1");
    await expectError(await del("g-1", { version: 9 }), 409, "CONFLICT");
    expect(await stored()).toHaveLength(1);
    expect(
      (await auditToday()).filter((r) => r.action === "groupmap.delete"),
    ).toEqual([]);
  });

  it("404 NOT_FOUND for an unmapped group (same body whichever id), no audit record", async () => {
    const a = await expectError(await del("g-missing-a"), 404, "NOT_FOUND");
    const b = await expectError(await del("g-missing-b"), 404, "NOT_FOUND");
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toContain("g-missing");
    expect(await auditToday()).toEqual([]);
  });

  it("400 for a wrong content type, a missing version and a malformed path id; no denied record", async () => {
    await seed("g-1");
    await expectError(
      await del("g-1", { version: 1 }, { contentType: "text/plain" }),
      400,
      "BAD_REQUEST",
    );
    await expectError(await del("g-1", {}), 400, "BAD_REQUEST");
    await expectError(await del("bad id", { version: 1 }), 400, "BAD_REQUEST");
    expect(await stored()).toHaveLength(1);
    expect(
      await auditToday().then((r) =>
        r.filter((x) => x.action === "groupmap.delete"),
      ),
    ).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });
});
