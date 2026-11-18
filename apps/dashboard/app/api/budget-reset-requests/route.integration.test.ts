import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  DAY_MS,
  NOW,
  auditActions,
  claimOf,
  createRequest,
  kindsOf,
  listRequests,
  loadRequests,
  makeMember,
  mineOf,
  notifRowsOf,
  notificationsOf,
  requestRow,
  seedSeenRoles,
  send,
  setToggles,
  setupBudgetResetSuite,
  signInAs,
  decide,
} from "@/test/support/budget-reset-support";

// Sources: docs/specs/2026-11-10-litellm.md - "Budget reset requests" (Flow
// steps 1-2, 5; MG-D11, MG-D12, MG-D13); Data Model - "Budget reset entities
// (unit M4)" and "API Routes" (POST/GET /api/budget-reset-requests); Access
// Control - "Permission matrix" -> "Budget reset requests" (role x operation
// table), threats BR6 (one open request per person per team, 7-day expiry,
// 280 characters) and BR7 (the reason is plain text, control characters
// refused, never copied into notifications or audit). The 401, 403-before-
// parse, 400 shape, no-store and denied-audit cases of every route are the
// shared route-contract suite's (Rule 60.23); only role x team outcomes and
// route-specific behaviour are here (Rule 60.24a).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupBudgetResetSuite();

const TEXT = (n: number) => "x".repeat(n);
const advance = (ms: number) =>
  vi.setSystemTime(new Date(Date.parse(NOW) + ms));

describe("POST /api/budget-reset-requests: role x operation (Permission matrix; complete, it is security)", () => {
  // [caller, the linked team they are a member of (null: none), expected]
  const MATRIX: Array<
    [keyof typeof CALLERS, "team-a" | "team-c" | null, 201 | 403]
  > = [
    ["admin", "team-a", 201],
    ["orgAdmin", "team-a", 201],
    ["teamAdminA", "team-a", 201],
    ["deptAdminEng", "team-c", 201],
    ["memberA", "team-a", 201],
    ["auditor", "team-a", 403],
    ["viewerNone", null, 403],
    ["admin", null, 403],
    ["orgAdmin", null, 403],
    ["teamAdminA", null, 403],
  ];

  it.each(MATRIX)("%s (member of %s) is %s", async (who, team, expected) => {
    // memberA is already a member of team-a in the fixture.
    if (team !== null && who !== "memberA") {
      await makeMember(CALLERS[who].oid, team);
    }
    const { status, body } = await createRequest(who);
    expect(status).toBe(expected);
    const records = (await auditActions()).filter(
      (r) => r.action === "budgetreset.request.create",
    );
    expect(
      state.fake.calls,
      "a request alone changes nothing in LiteLLM",
    ).toEqual([]);
    if (expected === 201) {
      expect(body.data).toMatchObject({
        teamId: team,
        status: "open",
        requester: { oid: CALLERS[who].oid },
      });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        result: "success",
        actor: CALLERS[who].oid,
      });
      return;
    }
    expect(body.error.code).toBe("FORBIDDEN");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ result: "denied", code: "FORBIDDEN" });
    const all = await listRequests("admin", "team-a", "all");
    expect(all.body.data.items).toHaveLength(0);
  });

  it("the team is the caller's own member team: a teamId in the body is refused or ignored, never obeyed (Data Model - API Routes)", async () => {
    signInAs("memberA");
    const { POST } = await loadRequests();
    const { res, body } = await send(POST, {
      method: "POST",
      path: "/api/budget-reset-requests",
      params: {},
      body: { teamId: "team-b", reason: "mine" },
    });
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) expect(body.data.teamId).toBe("team-a");
    expect(
      (await listRequests("admin", "team-b", "all")).body.data.items,
    ).toEqual([]);
  });

  it("a member of a team that is not linked to LiteLLM is 409 CONFLICT and nothing is created (MG-D11: absent on an unlinked team)", async () => {
    await makeMember(CALLERS.viewerNone.oid, "team-u");
    const { status, body } = await createRequest("viewerNone");
    expect(status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
    expect(
      (await listRequests("admin", "team-u", "all")).body.data.items,
    ).toEqual([]);
  });

  it.each([
    ["requestBudgetReset is switched off", { requestBudgetReset: false }],
    ["resetMemberSpend is switched off", { resetMemberSpend: false }],
    ["resetMemberSpend was never switched on (LD10 default off)", {}],
  ])(
    "403 OPERATION_DISABLED when %s, nothing created (MG-D11: control absent while either toggle is off)",
    async (_name, toggles) => {
      await setToggles(toggles);
      const { status, body } = await createRequest("memberA");
      expect(status).toBe(403);
      expect(body.error.code).toBe("OPERATION_DISABLED");
      expect(
        (await listRequests("admin", "team-a", "all")).body.data.items,
      ).toEqual([]);
    },
  );
});

describe("POST /api/budget-reset-requests: one open request, expiry (BR6)", () => {
  it("a second open request by the same person for the same team is 409 CONFLICT; one claim and one request remain", async () => {
    const first = await createRequest("memberA", "first");
    expect(first.status).toBe(201);
    const second = await createRequest("memberA", "second");
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");
    expect(
      (await listRequests("admin", "team-a", "all")).body.data.items,
    ).toHaveLength(1);
    expect(await claimOf("team-a", CALLERS.memberA.oid)).toHaveLength(1);
  });

  it("two simultaneous requests by one person: exactly one is created", async () => {
    const [a, b] = await Promise.all([
      createRequest("memberA"),
      createRequest("memberA"),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it("after the 7-day expiry a new request is accepted (the stale claim does not block)", async () => {
    expect((await createRequest("memberA")).status).toBe(201);
    advance(7 * DAY_MS + 1000);
    expect((await createRequest("memberA")).status).toBe(201);
  });

  it("a decided request frees the person to ask again", async () => {
    const first = await createRequest("memberA");
    expect((await decide("admin", first.id, "deny")).status).toBe(200);
    expect((await createRequest("memberA")).status).toBe(201);
  });

  it("a request still open at day 6 stays open; at day 7 and after it reads as expired, is gone from the open list and the requester is told once (Flow 5; Data Model - lazy expiry)", async () => {
    const { id } = await createRequest("memberA");
    advance(6 * DAY_MS);
    expect(
      (await listRequests("teamAdminA", "team-a")).body.data.items,
    ).toHaveLength(1);

    advance(7 * DAY_MS + 1000);
    expect(
      (await listRequests("teamAdminA", "team-a")).body.data.items,
    ).toHaveLength(0);
    const all = await listRequests("teamAdminA", "team-a", "all");
    expect(all.body.data.items[0]).toMatchObject({ id, status: "expired" });
    // A second read must not notify again (the conditional move happens once).
    await listRequests("admin", "team-a");
    await mineOf("memberA");
    expect(
      kindsOf(await notifRowsOf(CALLERS.memberA.oid)).filter(
        (k) => k === "budget-reset.expired",
      ),
    ).toEqual(["budget-reset.expired"]);
    expect((await requestRow(id))?.status).toBe("expired");
    expect(await claimOf("team-a", CALLERS.memberA.oid)).toHaveLength(0);
  });
});

describe("POST /api/budget-reset-requests: who is told (MG-D13)", () => {
  it("each lead whose scope covers the team is notified; the requester, org-admins and admins are not", async () => {
    await seedSeenRoles(CALLERS.orgAdmin.oid, "oa@company.com", [
      "internal-org-admin",
    ]);
    await seedSeenRoles(CALLERS.admin.oid, "ad@company.com", [
      "internal-admin",
    ]);
    const { id } = await createRequest("memberA");
    for (const lead of ["teamAdminA", "deptAdminEng"] as const) {
      const rows = await notifRowsOf(CALLERS[lead].oid);
      expect(kindsOf(rows), lead).toEqual(["budget-reset.requested"]);
      expect(rows[0]?.requestId).toBe(id);
    }
    for (const other of ["memberA", "orgAdmin", "admin", "memberB"] as const) {
      expect(await notifRowsOf(CALLERS[other].oid), other).toEqual([]);
    }
  });

  it("with no lead on the team, every org-admin and admin is notified, never the requester", async () => {
    await seedSeenRoles(CALLERS.orgAdmin.oid, "oa@company.com", [
      "internal-org-admin",
    ]);
    await seedSeenRoles(CALLERS.admin.oid, "ad@company.com", [
      "internal-admin",
    ]);
    // team-c (dept-ops) has no team or department lead in the fixture.
    await makeMember(CALLERS.viewerNone.oid, "team-c");
    const made = await createRequest("viewerNone");
    expect(made.status).toBe(201);
    for (const who of ["orgAdmin", "admin"] as const) {
      expect(kindsOf(await notifRowsOf(CALLERS[who].oid)), who).toContain(
        "budget-reset.requested",
      );
    }
    for (const lead of ["teamAdminA", "deptAdminEng"] as const) {
      expect(await notifRowsOf(CALLERS[lead].oid), lead).toEqual([]);
    }
    expect(await notifRowsOf(CALLERS.viewerNone.oid)).toEqual([]);
  });

  it("the requester is excluded even when they hold the fallback role", async () => {
    await seedSeenRoles(CALLERS.orgAdmin.oid, "oa@company.com", [
      "internal-org-admin",
    ]);
    await seedSeenRoles(CALLERS.admin.oid, "ad@company.com", [
      "internal-admin",
    ]);
    await makeMember(CALLERS.admin.oid, "team-c");
    const made = await createRequest("admin");
    expect(made.status).toBe(201);
    expect(await notifRowsOf(CALLERS.admin.oid)).toEqual([]);
    expect(kindsOf(await notifRowsOf(CALLERS.orgAdmin.oid))).toEqual([
      "budget-reset.requested",
    ]);
  });

  it("a request is a pointer: the deciders' notification is visible to the lead through the list route", async () => {
    const { id } = await createRequest("memberA", "please");
    const { body } = await notificationsOf("teamAdminA");
    expect(body.data.items[0]).toMatchObject({
      kind: "budget-reset.requested",
      requestId: id,
      canDecide: true,
    });
  });
});

describe("POST /api/budget-reset-requests: the reason (BR7)", () => {
  it("accepts exactly 280 characters (the cap is inclusive)", async () => {
    const made = await createRequest("memberA", TEXT(280));
    expect(made.status).toBe(201);
    expect(made.body.data.reason).toHaveLength(280);
  });

  it.each([
    ["281 characters", TEXT(281)],
    ["whitespace only", "   \t  "],
    ["a NUL control character", "reset\u0000please"],
    ["a BEL control character", "reset\u0007please"],
    ["a tab (C0 control)", "reset\tplease"],
    ["DEL", "reset\u007fplease"],
    ["an escape sequence", "\u001b[31mred"],
    ["a non-string", 42 as unknown as string],
  ])(
    "refuses a reason of %s with 400 BAD_REQUEST and creates nothing",
    async (_n, reason) => {
      const { status, body } = await createRequest("memberA", reason);
      expect(status).toBe(400);
      expect(body.error.code).toBe("BAD_REQUEST");
      expect(
        (await listRequests("admin", "team-a", "all")).body.data.items,
      ).toEqual([]);
    },
  );

  it("keeps a line feed, trims the edges and stores markup as literal text", async () => {
    const reason =
      "  line one\nline two <script>alert(1)</script> <img onerror=x>  ";
    const { status, body } = await createRequest("memberA", reason);
    expect(status).toBe(201);
    expect(body.data.reason).toBe(reason.trim());
    const listed = await listRequests("teamAdminA", "team-a");
    expect(listed.body.data.items[0].reason).toBe(reason.trim());
  });

  it("is not copied into notifications or audit records", async () => {
    const marker = "UNIQUE-REASON-MARKER-7731";
    await createRequest("memberA", marker);
    for (const lead of ["teamAdminA", "deptAdminEng"] as const) {
      expect(
        JSON.stringify(await notifRowsOf(CALLERS[lead].oid)),
      ).not.toContain(marker);
    }
    expect(JSON.stringify(await auditActions())).not.toContain(marker);
  });

  it("an omitted reason is allowed (optional)", async () => {
    const { status, body } = await createRequest("memberA");
    expect(status).toBe(201);
    expect(body.data.reason).toBeNull();
  });
});

describe("GET /api/budget-reset-requests?teamId=: role x team (Permission matrix; complete)", () => {
  // [caller, the team asked for, expected]. The one request belongs to team-a
  // (made by memberA); team-c is another team's, outside the Leads' scope.
  const MATRIX: Array<[keyof typeof CALLERS, "team-a" | "team-c", 200 | 404]> =
    [
      ["admin", "team-a", 200],
      ["orgAdmin", "team-a", 200],
      ["auditor", "team-a", 200],
      ["teamAdminA", "team-a", 200],
      ["deptAdminEng", "team-a", 200],
      ["teamAdminA", "team-c", 404],
      ["deptAdminEng", "team-c", 404],
      ["memberA", "team-a", 404],
      ["memberB", "team-a", 404],
      ["viewerNone", "team-a", 404],
    ];

  it.each(MATRIX)("%s asking for %s is %s", async (who, team, expected) => {
    await createRequest("memberA", "needs budget");
    const { status, body } = await listRequests(who, team);
    expect(status).toBe(expected);
    if (expected === 200) {
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]).toMatchObject({
        teamId: team,
        status: "open",
        requester: { oid: CALLERS.memberA.oid },
      });
    } else {
      expect(body.error.code).toBe("NOT_FOUND");
    }
  });

  it("an out-of-scope team answers the same 404 body as a missing team (BR5; Enforcement item 2)", async () => {
    const outOfScope = await listRequests("teamAdminA", "team-b");
    const missing = await listRequests("teamAdminA", "team-zzz");
    expect(outOfScope.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(outOfScope.text).toBe(missing.text);
  });

  it("status=open (default) lists only open requests; status=all adds the decided ones", async () => {
    const { id } = await createRequest("memberA");
    await decide("admin", id, "deny");
    expect((await listRequests("admin", "team-a")).body.data.items).toEqual([]);
    const all = await listRequests("admin", "team-a", "all");
    expect(
      all.body.data.items.map((i: { status: string }) => i.status),
    ).toEqual(["denied"]);
  });
});
