import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { appendAuditRecord, resetDeniedAudit } from "@/lib/data/access/audit";
import {
  auditToday,
  deniedToday,
  expectData,
  expectError,
  invoke,
  signInAs,
} from "@/test/support/governance-route-support";
import {
  clearTable,
  ensureTestTable,
  putRaw,
} from "@/test/support/test-support";

import { GET } from "../audit/route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/audit GET internal-admin or internal-auditor, audited), "Audit log"
// (schema; "Audit-log views ... are themselves audited"; never secrets),
// "Data model additions" (audit by day: Query PK=AUDIT#{day}, UTC),
// "Enforcement" items 2, 4 and the error-code registry (a bad or foreign list
// cursor is 400 BAD_REQUEST; read refusals are metric-only, no `denied`
// record). Spec: Access Control "API routes (additions)". Decisions: the
// day is `?day=YYYY-MM-DD` (UTC, default today, an impossible date is 400);
// the list is `data: { items, cursor? }` oldest first; one `audit.view`
// record (category change) per successful view, none on 400/401/403. Only
// `@/auth` is mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const AUDIT = "/api/audit";
const DAY = "2026-10-01";
const get = (query = "") =>
  invoke(GET, { method: "GET", path: `${AUDIT}${query}` });

type Item = {
  action: string;
  actor: string;
  requestId: string;
  result: string;
  timestamp: string;
  [key: string]: unknown;
};
type Listed = { items: Item[]; cursor?: string };

async function seed(day: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await appendAuditRecord({
      actor: "oid-actor",
      action: "groupmap.create",
      category: "change",
      target: { type: "groupmap", id: `g-${i}` },
      result: "success",
      timestamp: `${day}T10:00:0${i}.000Z`,
      requestId: `req-${day}-${i}`,
    });
  }
}

const viewsToday = async () =>
  (await auditToday()).filter((r) => r.action === "audit.view");

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  signInAs("admin");
});

describe("GET /api/audit", () => {
  it.each(["viewer", "orgAdmin", "noRoles"] as const)(
    "403 FORBIDDEN for %s; no audit.view and no denied record (read refusals are metric-only)",
    async (caller) => {
      await seed(DAY, 1);
      signInAs(caller);
      await expectError(await get(`?day=${DAY}`), 403, "FORBIDDEN");
      await expectError(await get("?day=not-a-day"), 403, "FORBIDDEN");
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it.each(["admin", "auditor"] as const)(
    "%s reads one day's records oldest first, as { items }",
    async (caller) => {
      await seed(DAY, 3);
      await seed("2026-10-02", 2);
      signInAs(caller);
      const data = await expectData<Listed>(await get(`?day=${DAY}`));
      expect(data.items.map((i) => i.requestId)).toEqual([
        `req-${DAY}-0`,
        `req-${DAY}-1`,
        `req-${DAY}-2`,
      ]);
      expect(data.items[0]).toMatchObject({
        actor: "oid-actor",
        action: "groupmap.create",
        category: "change",
        result: "success",
        target: { type: "groupmap", id: "g-0" },
      });
      expect(data.cursor).toBeUndefined();
    },
  );

  it("returns an empty list for a day with no records", async () => {
    const data = await expectData<Listed>(await get("?day=2026-01-01"));
    expect(data.items).toEqual([]);
  });

  it("defaults the day to today (UTC): today's records are listed", async () => {
    const now = new Date().toISOString();
    await appendAuditRecord({
      actor: "oid-actor",
      action: "groupmap.create",
      category: "change",
      target: { type: "groupmap", id: "g-today" },
      result: "success",
      timestamp: now,
      requestId: "req-today",
    });
    const data = await expectData<Listed>(await get());
    expect(data.items.map((i) => i.requestId)).toContain("req-today");
  });

  it("exposes only the sanitised audit fields: no storage keys, no stray attributes (never secrets)", async () => {
    await putRaw({
      PK: `AUDIT#${DAY}`,
      SK: `${DAY}T11:00:00.000Z#req-secret#00`,
      actor: "oid-actor",
      action: "groupmap.create",
      category: "change",
      target: { type: "groupmap", id: "g-1" },
      result: "success",
      timestamp: `${DAY}T11:00:00.000Z`,
      requestId: "req-secret",
      expiresAt: 1_900_000_000,
      passwordHash: "hunter2-secret",
    });
    const res = await get(`?day=${DAY}`);
    const text = await res.clone().text();
    expect(text).not.toContain("hunter2-secret");
    const data = await expectData<Listed>(res);
    const keys = Object.keys(data.items[0] ?? {});
    for (const forbidden of [
      "PK",
      "SK",
      "expiresAt",
      "passwordHash",
      "gsi1pk",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("writes exactly one audit.view record (category change, actor = the viewer) per successful view", async () => {
    await seed(DAY, 1);
    await expectData(await get(`?day=${DAY}`));
    let views = await viewsToday();
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      action: "audit.view",
      category: "change",
      result: "success",
      actor: "oid-admin",
    });
    expect(views[0]?.target).toBeDefined();
    signInAs("auditor");
    await expectData(await get(`?day=${DAY}`));
    views = await viewsToday();
    expect(views).toHaveLength(2);
    expect(views.map((v) => v.actor).sort()).toEqual([
      "oid-admin",
      "oid-auditor",
    ]);
  });

  it.each([
    ["an impossible month", "2026-13-01"],
    ["an impossible day", "2026-02-30"],
    ["a compact date", "20261001"],
    ["a word", "yesterday"],
    ["an empty value", ""],
    ["a timestamp", "2026-10-01T00:00:00Z"],
    ["a trailing newline", "2026-10-01%0A"],
  ])("400 BAD_REQUEST for %s; nothing audited", async (_n, day) => {
    await expectError(await get(`?day=${day}`), 400, "BAD_REQUEST");
    expect(await auditToday()).toEqual([]);
  });

  it.each(["0", "abc", "1000", "-1"])(
    "400 BAD_REQUEST for limit=%s; nothing audited",
    async (limit) => {
      await expectError(
        await get(`?day=${DAY}&limit=${limit}`),
        400,
        "BAD_REQUEST",
      );
      expect(await auditToday()).toEqual([]);
    },
  );

  it("pages with an opaque cursor: every record exactly once, in order, one audit.view per page request", async () => {
    await seed(DAY, 5);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const query: string = `?day=${DAY}&limit=2${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }`;
      const data = await expectData<Listed>(await get(query));
      expect(data.items.length).toBeLessThanOrEqual(2);
      seen.push(...data.items.map((i) => i.requestId));
      cursor = data.cursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual([0, 1, 2, 3, 4].map((i) => `req-${DAY}-${i}`));
    expect(await viewsToday()).toHaveLength(pages);
  });

  it("400 BAD_REQUEST for a garbled cursor and for a cursor minted for another day; nothing audited", async () => {
    await seed(DAY, 3);
    await seed("2026-10-02", 3);
    const first = await expectData<Listed>(await get(`?day=${DAY}&limit=1`));
    expect(first.cursor).toBeDefined();
    const before = (await viewsToday()).length;
    await expectError(
      await get(`?day=${DAY}&cursor=garbage`),
      400,
      "BAD_REQUEST",
    );
    await expectError(
      await get(
        `?day=2026-10-02&cursor=${encodeURIComponent(first.cursor ?? "")}`,
      ),
      400,
      "BAD_REQUEST",
    );
    expect(await viewsToday()).toHaveLength(before);
  });
});
