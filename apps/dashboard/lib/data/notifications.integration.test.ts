import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { NotificationKind } from "@llm-usage-lens/shared";

import {
  CURSOR_SECRET,
  OID_A,
  OID_B,
  collectPages,
  ok,
} from "@/test/support/access-test-support";
import {
  clearTable,
  ensureTestTable,
  putRaw,
} from "@/test/support/test-support";

import {
  countUnread,
  createNotifications,
  listNotifications,
  markNotificationsRead,
} from "./notifications";

// Sources: Data Model - "Budget reset entities (unit M4)" -> Notification
// (PK NOTIF#{recipientOid}, SK {createdAt}#{notificationId}, TTL createdAt +
// 90 days, ids only, readAt absent until read) and "Access patterns (unit M4)"
// (list newest first, Limit 20, signed cursor; unread COUNT paginated; mark
// read with attribute_exists(PK), a foreign or missing id changes nothing and
// is not an error). Keys are written out here from the spec, not imported.
// Rule 60.22: DynamoDB Local, no mocks.
const REQ = "00000000-0000-4000-8000-0000000000c1";
const opts = { cursorSecret: CURSOR_SECRET };
const at = (minutes: number) =>
  new Date(Date.parse("2026-11-14T10:00:00.000Z") + minutes * 60_000);
const entry = (
  oid: string,
  kind: NotificationKind = "budget-reset.requested",
) => ({
  recipientOid: oid,
  kind,
  requestId: REQ,
  teamId: "team-a",
});

beforeAll(ensureTestTable);
beforeEach(clearTable);

describe("createNotifications (Data Model - Notification)", () => {
  it("writes one item per recipient under the recipient's own partition, ids only, unread, expiring after 90 days", async () => {
    await createNotifications([entry(OID_A), entry(OID_B)], at(0));
    for (const oid of [OID_A, OID_B]) {
      const page = ok(await listNotifications(oid, opts));
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        recipientOid: oid,
        kind: "budget-reset.requested",
        requestId: REQ,
        teamId: "team-a",
        createdAt: "2026-11-14T10:00:00.000Z",
        readAt: null,
      });
      expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
        [
          "createdAt",
          "kind",
          "notificationId",
          "readAt",
          "recipientOid",
          "requestId",
          "teamId",
        ].sort(),
      );
    }
  });

  it("writes more than one BatchWriteItem's worth (25) of recipients without losing one", async () => {
    const oids = Array.from(
      { length: 60 },
      (_, i) => `00000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`,
    );
    await createNotifications(
      oids.map((oid) => entry(oid)),
      at(0),
    );
    for (const oid of oids) {
      expect(await countUnread(oid), oid).toBe(1);
    }
  });

  it("an empty recipient list writes nothing and does not throw", async () => {
    await expect(createNotifications([], at(0))).resolves.toBeUndefined();
  });

  it("two notifications for one person in the same instant both exist (the id is part of the SK)", async () => {
    await createNotifications(
      [entry(OID_A), entry(OID_A, "budget-reset.approved")],
      at(0),
    );
    expect(ok(await listNotifications(OID_A, opts)).items).toHaveLength(2);
  });
});

describe("listNotifications (Access patterns: newest first, Limit 20, signed cursor)", () => {
  it("lists newest first", async () => {
    await createNotifications([entry(OID_A)], at(0));
    await createNotifications([entry(OID_A, "budget-reset.approved")], at(5));
    await createNotifications([entry(OID_A, "budget-reset.denied")], at(10));
    const { items } = ok(await listNotifications(OID_A, opts));
    expect(items.map((n) => n.kind)).toEqual([
      "budget-reset.denied",
      "budget-reset.approved",
      "budget-reset.requested",
    ]);
  });

  it("pages on the cursor: 45 items arrive as 20 + 20 + 5, none repeated, none missing", async () => {
    for (let i = 0; i < 45; i += 1) {
      await createNotifications([entry(OID_A)], at(i));
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    const sizes: number[] = [];
    do {
      const page = ok(await listNotifications(OID_A, { ...opts, cursor }));
      sizes.push(page.items.length);
      seen.push(...page.items.map((n) => n.notificationId));
      cursor = page.cursor;
    } while (cursor && sizes.length < 10);
    expect(sizes).toEqual([20, 20, 5]);
    expect(new Set(seen).size).toBe(45);
  });

  it("collectPages reads every page of a long list (pagination loop)", async () => {
    for (let i = 0; i < 25; i += 1) {
      await createNotifications([entry(OID_A)], at(i));
    }
    const all = await collectPages((cursor) =>
      listNotifications(OID_A, { ...opts, cursor }),
    );
    expect(all.items).toHaveLength(25);
    expect(all.pages).toBeGreaterThanOrEqual(2);
  });

  it("never returns another person's items", async () => {
    await createNotifications([entry(OID_B)], at(0));
    expect(ok(await listNotifications(OID_A, opts)).items).toEqual([]);
  });

  it("a cursor from one person is BAD_CURSOR for another (BR5: keys from the session)", async () => {
    for (let i = 0; i < 25; i += 1) {
      await createNotifications([entry(OID_A), entry(OID_B)], at(i));
    }
    const first = ok(await listNotifications(OID_A, opts));
    expect(first.cursor).toBeDefined();
    const stolen = await listNotifications(OID_B, {
      ...opts,
      cursor: first.cursor,
    });
    expect(stolen).toMatchObject({ ok: false, code: "BAD_CURSOR" });
  });

  it("a cursor signed with another secret, or forged, is BAD_CURSOR (Access Control - Storage boundary item 4)", async () => {
    for (let i = 0; i < 25; i += 1) {
      await createNotifications([entry(OID_A)], at(i));
    }
    const first = ok(await listNotifications(OID_A, opts));
    expect(
      await listNotifications(OID_A, {
        cursorSecret: "another-secret",
        cursor: first.cursor,
      }),
    ).toMatchObject({ ok: false, code: "BAD_CURSOR" });
    expect(
      await listNotifications(OID_A, { ...opts, cursor: "not-a-cursor" }),
    ).toMatchObject({ ok: false, code: "BAD_CURSOR" });
  });
});

describe("countUnread (Access patterns: COUNT with a filter, paginated)", () => {
  it("counts only the unread items of that person", async () => {
    await createNotifications([entry(OID_A), entry(OID_B)], at(0));
    await createNotifications([entry(OID_A)], at(1));
    expect(await countUnread(OID_A)).toBe(2);
    expect(await countUnread(OID_B)).toBe(1);
    expect(await countUnread("00000000-0000-4000-8000-0000000000ee")).toBe(0);
  });

  it("counts across DynamoDB pages (more than 1 MB of items is read in several queries)", async () => {
    const filler = "x".repeat(380_000);
    for (let i = 0; i < 4; i += 1) {
      await putRaw({
        PK: `NOTIF#${OID_A}`,
        SK: `2026-11-14T10:0${i}:00.000Z#00000000-0000-4000-8000-00000000000${i}`,
        notificationId: `00000000-0000-4000-8000-00000000000${i}`,
        recipientOid: OID_A,
        kind: "budget-reset.requested",
        requestId: REQ,
        teamId: "team-a",
        createdAt: `2026-11-14T10:0${i}:00.000Z`,
        filler,
      });
    }
    expect(await countUnread(OID_A)).toBe(4);
  });
});

describe("markNotificationsRead (Access patterns: own partition only)", () => {
  it("marks the listed ids read, once, and reports how many changed", async () => {
    await createNotifications([entry(OID_A)], at(0));
    await createNotifications([entry(OID_A)], at(1));
    const [newest, oldest] = ok(await listNotifications(OID_A, opts)).items;
    const id = (n?: { createdAt: string; notificationId: string }) =>
      `${n?.createdAt}#${n?.notificationId}`;
    expect(
      await markNotificationsRead(OID_A, { ids: [id(newest)] }, at(30)),
    ).toBe(1);
    expect(
      await markNotificationsRead(OID_A, { ids: [id(newest)] }, at(31)),
    ).toBe(0);
    expect(await countUnread(OID_A)).toBe(1);
    const after = ok(await listNotifications(OID_A, opts)).items;
    expect(
      after.find((n) => n.notificationId === newest?.notificationId),
    ).toMatchObject({ readAt: at(30).toISOString() });
    expect(
      after.find((n) => n.notificationId === oldest?.notificationId),
    ).toMatchObject({ readAt: null });
  });

  it("a missing id and another person's id count 0, throw nothing and change nothing", async () => {
    await createNotifications([entry(OID_B)], at(0));
    const [theirs] = ok(await listNotifications(OID_B, opts)).items;
    const foreign = `${theirs?.createdAt}#${theirs?.notificationId}`;
    const missing =
      "2026-01-01T00:00:00.000Z#00000000-0000-4000-8000-0000000000ff";
    expect(
      await markNotificationsRead(OID_A, { ids: [foreign, missing] }, at(30)),
    ).toBe(0);
    expect(await countUnread(OID_B)).toBe(1);
    expect(await countUnread(OID_A)).toBe(0);
  });

  it("an id for a missing item does not create one (attribute_exists(PK))", async () => {
    const missing =
      "2026-01-01T00:00:00.000Z#00000000-0000-4000-8000-0000000000ff";
    await markNotificationsRead(OID_A, { ids: [missing] }, at(0));
    expect(ok(await listNotifications(OID_A, opts)).items).toEqual([]);
  });

  it("all: true marks every unread item of the caller, across pages, and none of anyone else's", async () => {
    for (let i = 0; i < 30; i += 1) {
      await createNotifications([entry(OID_A)], at(i));
    }
    await createNotifications([entry(OID_B)], at(0));
    expect(await markNotificationsRead(OID_A, { all: true }, at(60))).toBe(30);
    expect(await countUnread(OID_A)).toBe(0);
    expect(await countUnread(OID_B)).toBe(1);
    expect(await markNotificationsRead(OID_A, { all: true }, at(61))).toBe(0);
  });
});
