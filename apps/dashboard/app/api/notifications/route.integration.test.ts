import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  DAY_MS,
  auditActions,
  createRequest,
  decide,
  grantLeadScope,
  loadMarkRead,
  loadNotifications,
  notifRowsOf,
  notificationsOf,
  revokeLeadScope,
  send,
  setupBudgetResetSuite,
  signInAs,
} from "@/test/support/budget-reset-support";

// Sources: Data Model - "Budget reset entities (unit M4)" (Notification: ids
// only, API id = SK `{createdAt}#{notificationId}`, 90-day expiry) and API
// Routes (`GET /api/notifications`, `POST /api/notifications/read`: own
// notifications only, keys from the session, not audited); LiteLLM spec -
// MG-D13 (a notification is a pointer; its buttons re-read the request; a
// notification whose request the caller may no longer decide shows no
// request details); Access Control BR1, BR5, BR8. 401, 400 shape and no-store
// are the shared route-contract suite's (Rule 60.23).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

setupBudgetResetSuite();

const MARKER = "SECRET-REASON-5521";
const REQUESTER_EMAIL = CALLERS.memberA.email;

async function markRead(as: Parameters<typeof signInAs>[0], body: unknown) {
  signInAs(as);
  const POST = await loadMarkRead();
  return send(POST, {
    method: "POST",
    path: "/api/notifications/read",
    params: {},
    body,
  });
}

describe("GET /api/notifications: own notifications only (BR5; MG-D13)", () => {
  it("each recipient lists only the notifications addressed to them", async () => {
    const { id } = await createRequest("memberA", MARKER);
    const lead = await notificationsOf("teamAdminA");
    const dept = await notificationsOf("deptAdminEng");
    for (const res of [lead, dept]) {
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]).toMatchObject({
        kind: "budget-reset.requested",
        requestId: id,
        read: false,
        canDecide: true,
        request: { id, status: "open", reason: MARKER },
      });
      expect(res.body.data.unreadCount).toBe(1);
    }
    expect(lead.body.data.items[0].id).not.toBe(dept.body.data.items[0].id);
    for (const nobody of ["memberA", "memberB", "orgAdmin", "admin"] as const) {
      const res = await notificationsOf(nobody);
      expect(res.body.data.items, nobody).toEqual([]);
      expect(res.body.data.unreadCount, nobody).toBe(0);
    }
  });

  it("the API id of a notification is its sort key `{createdAt}#{notificationId}`", async () => {
    await createRequest("memberA");
    const [item] = (await notificationsOf("teamAdminA")).body.data.items;
    const [row] = await notifRowsOf(CALLERS.teamAdminA.oid);
    expect(item.id).toBe(row?.SK);
    expect(item.id).toMatch(
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("stores ids only (no name, email, reason or amount) and expires after 90 days (Data Model)", async () => {
    await createRequest("memberA", MARKER);
    const [row] = await notifRowsOf(CALLERS.teamAdminA.oid);
    const text = JSON.stringify(row);
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain(REQUESTER_EMAIL);
    expect(row).toMatchObject({
      recipientOid: CALLERS.teamAdminA.oid,
      kind: "budget-reset.requested",
      teamId: "team-a",
    });
    expect(row?.readAt ?? null).toBeNull();
    expect(row?.expiresAt).toBe(
      Math.floor(Date.parse(String(row?.createdAt)) / 1000) + 90 * 86_400,
    );
  });

  it("the requester sees their own result with the request, and no decision buttons", async () => {
    const { id } = await createRequest("memberA", "mine");
    await decide("admin", id, "deny");
    const { body } = await notificationsOf("memberA");
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      kind: "budget-reset.denied",
      canDecide: false,
      request: { id, status: "denied" },
    });
  });

  it("the requester is told of an approval, with the request, and can decide nothing (MG-D13)", async () => {
    const { id } = await createRequest("memberA", "mine");
    expect((await decide("teamAdminA", id, "approve")).status).toBe(200);
    const { body } = await notificationsOf("memberA");
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      kind: "budget-reset.approved",
      canDecide: false,
      request: { id, status: "approved" },
    });
    expect(body.data.unreadCount).toBe(1);
  });

  it("the requester is told once when the request expires, and the deciders keep theirs without buttons (MG-D13; Data Model - lazy expiry)", async () => {
    const { id } = await createRequest("memberA");
    vi.setSystemTime(Date.now() + 8 * DAY_MS);
    await notificationsOf("teamAdminA");
    const first = await notificationsOf("memberA");
    const second = await notificationsOf("memberA");
    expect(first.body.data.items.map((i: { kind: string }) => i.kind)).toEqual([
      "budget-reset.expired",
    ]);
    expect(second.body.data.items).toHaveLength(1);
    expect(first.body.data.items[0]).toMatchObject({
      requestId: id,
      canDecide: false,
      request: { status: "expired" },
    });
  });

  it("a decided request no longer offers the decision (canDecide false) to the lead who was notified", async () => {
    const { id } = await createRequest("memberA");
    await decide("admin", id, "approve");
    const { body } = await notificationsOf("teamAdminA");
    expect(body.data.items[0]).toMatchObject({
      requestId: id,
      canDecide: false,
    });
  });

  it("an expired request offers no decision either", async () => {
    await createRequest("memberA");
    vi.setSystemTime(Date.now() + 8 * DAY_MS);
    const { body } = await notificationsOf("teamAdminA");
    expect(body.data.items[0].canDecide).toBe(false);
  });
});

describe("GET /api/notifications: cursor (Data Model - Access patterns; Access Control - Storage boundary item 4)", () => {
  it("a forged cursor is 400 and lists nothing", async () => {
    await createRequest("memberA");
    signInAs("teamAdminA");
    const { GET } = await loadNotifications();
    const { res, text } = await send(GET, {
      method: "GET",
      path: "/api/notifications?cursor=forged",
      params: {},
    });
    expect(res.status).toBe(400);
    expect(text).not.toContain("budget-reset");
  });
});

describe("GET /api/notifications: a notification hides the request after its recipient lost access (BR8)", () => {
  it("a Lead who lost the team's scope sees the notification but no name, email, reason or buttons", async () => {
    await createRequest("memberA", MARKER);
    await grantLeadScope(CALLERS.teamAdminA.oid, "team", "team-c");
    await revokeLeadScope(CALLERS.teamAdminA.oid, "team", "team-a");
    const { status, body, text } = await notificationsOf("teamAdminA");
    expect(status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      request: null,
      canDecide: false,
    });
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain(REQUESTER_EMAIL);
    expect(text).not.toContain(CALLERS.memberA.oid);
  });

  it("a Lead who lost every scope is shown the same", async () => {
    await createRequest("memberA", MARKER);
    await revokeLeadScope(CALLERS.teamAdminA.oid, "team", "team-a");
    const { body, text } = await notificationsOf("teamAdminA");
    expect(body.data.items[0]).toMatchObject({
      request: null,
      canDecide: false,
    });
    expect(text).not.toContain(MARKER);
  });

  it("a notification never widens access: holding it grants no right to decide (BR1)", async () => {
    const { id } = await createRequest("memberA");
    await revokeLeadScope(CALLERS.teamAdminA.oid, "team", "team-a");
    const { status } = await decide("teamAdminA", id, "approve");
    expect([403, 404]).toContain(status);
  });
});

describe("POST /api/notifications/read: own state only (BR5)", () => {
  it("marks the caller's notifications read by id and lowers the unread count", async () => {
    await createRequest("memberA");
    const [item] = (await notificationsOf("teamAdminA")).body.data.items;
    const { res, body } = await markRead("teamAdminA", { ids: [item.id] });
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ updated: 1 });
    const after = await notificationsOf("teamAdminA");
    expect(after.body.data.items[0].read).toBe(true);
    expect(after.body.data.unreadCount).toBe(0);
  });

  it("`all: true` marks only the caller's own notifications", async () => {
    await createRequest("memberA");
    const { body } = await markRead("teamAdminA", { all: true });
    expect(body.data.updated).toBe(1);
    const [other] = await notifRowsOf(CALLERS.deptAdminEng.oid);
    expect(other?.readAt ?? null).toBeNull();
    expect((await notificationsOf("deptAdminEng")).body.data.unreadCount).toBe(
      1,
    );
  });

  it("another person's notification id is neither read nor changed", async () => {
    await createRequest("memberA");
    const [foreign] = (await notificationsOf("deptAdminEng")).body.data.items;
    const { res, body } = await markRead("teamAdminA", { ids: [foreign.id] });
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) expect(body.data.updated).toBe(0);
    const [row] = await notifRowsOf(CALLERS.deptAdminEng.oid);
    expect(row?.readAt ?? null).toBeNull();
    const mine = await notificationsOf("teamAdminA");
    expect(mine.body.data.items.map((i: { id: string }) => i.id)).not.toContain(
      foreign.id,
    );
    expect(mine.body.data.unreadCount).toBe(1);
  });

  it("is not audited (own state; Access Control - audit actions)", async () => {
    await createRequest("memberA");
    const before = (await auditActions()).length;
    await markRead("teamAdminA", { all: true });
    expect((await auditActions()).length).toBe(before);
  });

  it.each([
    ["an empty id list", { ids: [] }],
    ["more than 50 ids", { ids: Array.from({ length: 51 }, () => "x") }],
    ["a malformed id", { ids: ["not-a-notification-id"] }],
    ["both forms", { ids: [], all: true }],
    ["all: false", { all: false }],
  ])("refuses %s with 400 and changes nothing", async (_n, input) => {
    await createRequest("memberA");
    const { res } = await markRead("teamAdminA", input);
    expect(res.status).toBe(400);
    const [row] = await notifRowsOf(CALLERS.teamAdminA.oid);
    expect(row?.readAt ?? null).toBeNull();
  });
});
