import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  DAY_MS,
  LTEAM,
  MEMBER_A_LUSER,
  NOW,
  auditActions,
  claimOf,
  createRequest,
  decide,
  failResetSpend,
  grantLeadScope,
  kindsOf,
  ledgerOf,
  listRequests,
  makeMember,
  notifRowsOf,
  requestRow,
  revokeLeadScope,
  setToggles,
  setupBudgetResetSuite,
  unlinkTeam,
} from "@/test/support/budget-reset-support";
import {
  bodyOf,
  callsTo,
  installMemberWritesFake,
  removeDashboardMembership,
  writeCalls,
} from "@/test/support/litellm-member-writes-support";

// Sources: docs/specs/2026-11-10-litellm.md - "Budget reset requests" (Flow
// steps 3-5; MG-D8 ledger, MG-D11 the reset that runs, MG-D12 who decides,
// MG-D12a the approving state); Data Model - API Routes (approve, deny);
// Access Control - "Permission matrix" -> "Budget reset requests" (role x
// operation table) and threats BR1 (a request never widens who may reset),
// BR2 (self-approval), BR3 (double approval), BR4 (everything re-checked at
// the decision), BR5 (same 404), BR9 (a LiteLLM failure is never reported as
// approved). 401, 403-before-parse, 400 and no-store are the shared route-
// contract suite's (Rule 60.23).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupBudgetResetSuite();

const VERBS = ["approve", "deny"] as const;
const RESET_PATH = `/team/${LTEAM["team-a"]}/member/${encodeURIComponent(MEMBER_A_LUSER)}/reset_spend`;
const advance = (ms: number) =>
  vi.setSystemTime(new Date(Date.parse(NOW) + ms));
const deniedFor = async (verb: string) =>
  (await auditActions()).filter(
    (r) => r.action === `budgetreset.request.${verb}` && r.result === "denied",
  );
const statusOf = async (id: string) => (await requestRow(id))?.status;

describe.each(VERBS)(
  "POST /api/budget-reset-requests/[id]/%s: role x operation (Permission matrix; complete, it is security)",
  (verb) => {
    // [caller, expected] for a request made by memberA in team-a (dept-eng).
    const ON_TEAM_A: Array<[keyof typeof CALLERS, 200 | 403]> = [
      ["admin", 200],
      ["orgAdmin", 200],
      ["teamAdminA", 200],
      ["deptAdminEng", 200],
      ["auditor", 403],
      ["memberB", 403],
      ["viewerNone", 403],
    ];

    it.each(ON_TEAM_A)(
      "%s on a team-a request is %s",
      async (who, expected) => {
        const { id } = await createRequest("memberA", "please");
        const { status, body } = await decide(who, id, verb);
        expect(status).toBe(expected);
        if (expected === 200) {
          expect(body.data.request).toMatchObject({
            id,
            status: verb === "approve" ? "approved" : "denied",
          });
          expect(await statusOf(id)).toBe(
            verb === "approve" ? "approved" : "denied",
          );
          return;
        }
        expect(body.error.code).toBe("FORBIDDEN");
        expect(await statusOf(id)).toBe("open");
        expect(state.fake.calls).toEqual([]);
        expect(await ledgerOf("team-a")).toEqual([]);
        const denied = await deniedFor(verb);
        expect(denied).toHaveLength(1);
        expect(denied[0]).toMatchObject({
          actor: CALLERS[who].oid,
          code: "FORBIDDEN",
        });
      },
    );

    it.each(["teamAdminA", "deptAdminEng"] as const)(
      "%s (Lead, other team) on a team-c request is 404, the same body as a missing id, with one denied record (BR5)",
      async (who) => {
        await makeMember(CALLERS.viewerNone.oid, "team-c");
        const { id } = await createRequest("viewerNone");
        const outOfScope = await decide(who, id, verb);
        expect((await deniedFor(verb)).map((r) => r.code)).toEqual([
          "NOT_FOUND",
        ]);
        const missing = await decide(
          who,
          "00000000-0000-4000-8000-00000000dead",
          verb,
        );
        expect(outOfScope.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(outOfScope.text).toBe(missing.text);
        expect(outOfScope.text).not.toContain(id);
        expect(await statusOf(id)).toBe("open");
        expect(state.fake.calls).toEqual([]);
      },
    );

    it.each(["admin", "orgAdmin", "teamAdminA", "deptAdminEng"] as const)(
      "%s deciding their own request is 403 FORBIDDEN with one denied record and no LiteLLM call, even though in scope (BR2)",
      async (who) => {
        await makeMember(CALLERS[who].oid, "team-a");
        const own = await createRequest(who, "for me");
        expect(own.status).toBe(201);
        const { status, body } = await decide(who, own.id, verb);
        expect(status).toBe(403);
        expect(body.error.code).toBe("FORBIDDEN");
        expect(state.fake.calls).toEqual([]);
        expect(await statusOf(own.id)).toBe("open");
        expect(await ledgerOf("team-a")).toEqual([]);
        const denied = await deniedFor(verb);
        expect(denied).toHaveLength(1);
        expect(denied[0]).toMatchObject({ actor: CALLERS[who].oid });
      },
    );

    it("a request that is no longer open is 409 CONFLICT (not open)", async () => {
      const { id } = await createRequest("memberA");
      expect((await decide("admin", id, "deny")).status).toBe(200);
      const again = await decide("orgAdmin", id, verb);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("CONFLICT");
      expect(state.fake.calls).toEqual([]);
    });

    it("a request past its 7-day expiry is 409 and no LiteLLM call is made (BR6)", async () => {
      const { id } = await createRequest("memberA");
      advance(7 * DAY_MS + 1000);
      const late = await decide("admin", id, verb);
      expect(late.status).toBe(409);
      expect(state.fake.calls).toEqual([]);
      expect(await statusOf(id)).toBe("expired");
    });

    it("a Lead whose scope on the team was revoked between request and decision (scope kept elsewhere) is 404 and nothing happens (BR1, BR4)", async () => {
      const { id } = await createRequest("memberA");
      await grantLeadScope(CALLERS.teamAdminA.oid, "team", "team-c");
      await revokeLeadScope(CALLERS.teamAdminA.oid, "team", "team-a");
      const { status, body } = await decide("teamAdminA", id, verb);
      expect(status).toBe(404);
      expect(body.error.code).toBe("NOT_FOUND");
      expect(state.fake.calls).toEqual([]);
      expect(await statusOf(id)).toBe("open");
      expect(await ledgerOf("team-a")).toEqual([]);
    });

    it("a notified person who lost every scope is refused (never 200) and nothing happens (BR1, BR4)", async () => {
      const { id } = await createRequest("memberA");
      await revokeLeadScope(CALLERS.teamAdminA.oid, "team", "team-a");
      const { status } = await decide("teamAdminA", id, verb);
      expect([403, 404]).toContain(status);
      expect(state.fake.calls).toEqual([]);
      expect(await statusOf(id)).toBe("open");
      expect(await ledgerOf("team-a")).toEqual([]);
    });
  },
);

describe("POST /api/budget-reset-requests/[id]/approve: the reset that runs (MG-D11, MG-D8)", () => {
  it("sends exactly one POST .../reset_spend with { reset_to: 0 } and never reset_budget", async () => {
    const { id } = await createRequest("memberA");
    const { status } = await decide("admin", id, "approve");
    expect(status).toBe(200);
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe("POST");
    expect(writes[0]?.path).toBe(RESET_PATH);
    expect(bodyOf(writes[0])).toEqual({ reset_to: 0 });
    expect(state.fake.calls.filter((c) => /reset_budget/.test(c.path))).toEqual(
      [],
    );
  });

  it("answers { request, resetId, amount } with the spend read before the reset", async () => {
    const { id } = await createRequest("memberA");
    const { body } = await decide("teamAdminA", id, "approve");
    expect(body.data.amount).toBe(3.25);
    expect(body.data.resetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data.request).toMatchObject({ id, status: "approved" });
  });

  it("writes one BudgetReset ledger item (trigger request) with the amount read before, and a 400-day expiry", async () => {
    const { id } = await createRequest("memberA");
    const { body } = await decide("admin", id, "approve");
    const ledger = await ledgerOf("team-a");
    expect(ledger).toHaveLength(1);
    const item = ledger[0] ?? {};
    expect(item).toMatchObject({
      resetId: body.data.resetId,
      oid: CALLERS.memberA.oid,
      teamId: "team-a",
      departmentId: "dept-eng",
      litellmTeamId: LTEAM["team-a"],
      litellmUserId: MEMBER_A_LUSER,
      operation: "spend",
      amount: 3.25,
      budget: 10,
      trigger: "request",
      actorOid: CALLERS.admin.oid,
      requestId: id,
      timestamp: NOW,
      gsi1pk: `BRESETS#IDENT#${CALLERS.memberA.oid}`,
    });
    expect(String(item.SK)).toBe(`${NOW}#${body.data.resetId}`);
    expect(item.expiresAt).toBe(Date.parse(NOW) / 1000 + 400 * 86_400);
  });

  it("audits the LiteLLM change (litellm.member.reset-spend, actor = the approver) and the approval", async () => {
    const { id } = await createRequest("memberA");
    await decide("orgAdmin", id, "approve");
    const records = await auditActions();
    expect(
      records.find((r) => r.action === "litellm.member.reset-spend"),
    ).toMatchObject({
      actor: CALLERS.orgAdmin.oid,
      result: "success",
      teamId: "team-a",
      target: { type: "litellm-user", id: MEMBER_A_LUSER },
      before: { spend: 3.25 },
      after: { spend: 0 },
    });
    expect(
      records.find((r) => r.action === "budgetreset.request.approve"),
    ).toMatchObject({ actor: CALLERS.orgAdmin.oid, result: "success" });
  });

  it("records the decision, frees the person to ask again and tells the requester once", async () => {
    const { id } = await createRequest("memberA");
    const { body } = await decide("admin", id, "approve");
    expect(await requestRow(id)).toMatchObject({
      status: "approved",
      decidedBy: CALLERS.admin.oid,
      resetId: body.data.resetId,
    });
    expect(await claimOf("team-a", CALLERS.memberA.oid)).toEqual([]);
    expect(kindsOf(await notifRowsOf(CALLERS.memberA.oid))).toEqual([
      "budget-reset.approved",
    ]);
    expect((await createRequest("memberA")).status).toBe(201);
  });

  it("two simultaneous approvals cause one reset_spend call, one ledger item, one approved notification and one 409 (BR3)", async () => {
    const { id } = await createRequest("memberA");
    const [a, b] = await Promise.all([
      decide("admin", id, "approve"),
      decide("admin", id, "approve"),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(callsTo(state, `POST ${RESET_PATH}`)).toHaveLength(1);
    expect(await ledgerOf("team-a")).toHaveLength(1);
    expect(
      (await auditActions()).filter(
        (r) => r.action === "budgetreset.request.approve",
      ),
    ).toHaveLength(1);
    expect(kindsOf(await notifRowsOf(CALLERS.memberA.oid))).toEqual([
      "budget-reset.approved",
    ]);
  });

  it("a second approval after the first is 409 CONFLICT and resets nothing more (BR3)", async () => {
    const { id } = await createRequest("memberA");
    await decide("admin", id, "approve");
    const second = await decide("orgAdmin", id, "approve");
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");
    expect(callsTo(state, `POST ${RESET_PATH}`)).toHaveLength(1);
    expect(await ledgerOf("team-a")).toHaveLength(1);
  });
});

describe("POST /api/budget-reset-requests/[id]/approve: an expired request whose claim passed to a newer one (review m4-r1 Q-B1; BR3, BR6, MG-D12a)", () => {
  it("R1 expires unread, R2 is created: R1 reads as expired, the open list holds only R2, approving R1 is 409 with no reset_spend call, no ledger item and no stuck approving", async () => {
    const r1 = await createRequest("memberA", "first");
    advance(7 * DAY_MS + 1000);
    const r2 = await createRequest("memberA", "second");
    expect(r2.status).toBe(201);

    const open = await listRequests("admin", "team-a");
    expect(open.body.data.items.map((i: { id: string }) => i.id)).toEqual([
      r2.id,
    ]);
    const all = await listRequests("admin", "team-a", "all");
    expect(
      all.body.data.items.find((i: { id: string }) => i.id === r1.id),
    ).toMatchObject({ status: "expired" });

    const late = await decide("admin", r1.id, "approve");
    expect(late.status).toBe(409);
    expect(callsTo(state, `POST ${RESET_PATH}`)).toEqual([]);
    expect(writeCalls(state)).toEqual([]);
    expect(await ledgerOf("team-a")).toEqual([]);
    expect(await statusOf(r1.id)).toBe("expired");
    expect(await statusOf(r2.id)).toBe("open");
  });
});

describe("POST /api/budget-reset-requests/[id]/approve: a LiteLLM failure (BR9; MG-D12, MG-D12a)", () => {
  it.each([
    ["reset_spend answers 500", () => failResetSpend(state)],
    ["LiteLLM is down", () => installMemberWritesFake(state, { outage: true })],
  ])(
    "when %s the request is open again, no ledger item is written, nobody is told it was approved and the failure is audited",
    async (_name, breakLiteLLM) => {
      const { id } = await createRequest("memberA");
      breakLiteLLM();
      const { status, body } = await decide("admin", id, "approve");
      expect(status).toBeGreaterThanOrEqual(500);
      expect(body.error).toBeDefined();
      expect(await statusOf(id)).toBe("open");
      expect(await ledgerOf("team-a")).toEqual([]);
      expect(await claimOf("team-a", CALLERS.memberA.oid)).toHaveLength(1);
      for (const who of ["memberA", "admin", "orgAdmin"] as const) {
        expect(kindsOf(await notifRowsOf(CALLERS[who].oid)), who).not.toContain(
          "budget-reset.approved",
        );
      }
      const records = await auditActions();
      expect(
        records.find((r) => r.action === "budgetreset.request.approve"),
      ).toBeUndefined();
      const reset = records.filter(
        (r) => r.action === "litellm.member.reset-spend",
      );
      expect(reset).toHaveLength(1);
      expect(reset[0]).toMatchObject({ result: "failed", teamId: "team-a" });
      // It is listed as open for the next decider, and can be approved once LiteLLM is back.
      expect(
        (await listRequests("admin", "team-a")).body.data.items,
      ).toHaveLength(1);
      installMemberWritesFake(state);
      expect((await decide("admin", id, "approve")).status).toBe(200);
      expect(await ledgerOf("team-a")).toHaveLength(1);
    },
  );
});

describe("POST /api/budget-reset-requests/[id]/approve: everything is re-checked at the decision (BR4, MG-D12)", () => {
  it("the requester left the team: refused, no LiteLLM write, no ledger item", async () => {
    const { id } = await createRequest("memberA");
    await removeDashboardMembership(CALLERS.memberA.oid, "team-a");
    const { status } = await decide("admin", id, "approve");
    expect([403, 404, 409]).toContain(status);
    expect(writeCalls(state)).toEqual([]);
    expect(await ledgerOf("team-a")).toEqual([]);
  });

  it("the team was unlinked from LiteLLM: refused, no LiteLLM write, no ledger item", async () => {
    const { id } = await createRequest("memberA");
    await unlinkTeam("team-a");
    const { status } = await decide("admin", id, "approve");
    expect([403, 404, 409]).toContain(status);
    expect(writeCalls(state)).toEqual([]);
    expect(await ledgerOf("team-a")).toEqual([]);
  });

  it.each([
    [
      "requestBudgetReset",
      { resetMemberSpend: true, requestBudgetReset: false },
    ],
    ["resetMemberSpend", { resetMemberSpend: false, requestBudgetReset: true }],
  ])(
    "%s was switched off after the request: 403 OPERATION_DISABLED, no LiteLLM call, no ledger item",
    async (_name, toggles) => {
      const { id } = await createRequest("memberA");
      await setToggles(toggles);
      const { status, body } = await decide("admin", id, "approve");
      expect(status).toBe(403);
      expect(body.error.code).toBe("OPERATION_DISABLED");
      expect(state.fake.calls).toEqual([]);
      expect(await ledgerOf("team-a")).toEqual([]);
      expect(await statusOf(id)).toBe("open");
    },
  );
});

describe("POST /api/budget-reset-requests/[id]/deny", () => {
  it("moves open to denied with no LiteLLM call, audits it, tells the requester and frees the claim (Flow 5)", async () => {
    const { id } = await createRequest("memberA", "please");
    const { status, body } = await decide("teamAdminA", id, "deny");
    expect(status).toBe(200);
    expect(body.data.request).toMatchObject({ id, status: "denied" });
    expect(state.fake.calls).toEqual([]);
    expect(await ledgerOf("team-a")).toEqual([]);
    expect(await requestRow(id)).toMatchObject({
      status: "denied",
      decidedBy: CALLERS.teamAdminA.oid,
    });
    expect(await claimOf("team-a", CALLERS.memberA.oid)).toEqual([]);
    expect(kindsOf(await notifRowsOf(CALLERS.memberA.oid))).toEqual([
      "budget-reset.denied",
    ]);
    expect(
      (await auditActions()).find(
        (r) => r.action === "budgetreset.request.deny",
      ),
    ).toMatchObject({ actor: CALLERS.teamAdminA.oid, result: "success" });
  });

  it("works while the reset toggles are off (a denial changes nothing in LiteLLM)", async () => {
    const { id } = await createRequest("memberA");
    await setToggles({ resetMemberSpend: false });
    expect((await decide("admin", id, "deny")).status).toBe(200);
  });
});
