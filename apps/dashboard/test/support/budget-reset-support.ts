import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { revokeAdminScope } from "@/lib/data/access/admin-scopes";
import { deleteTeamLink } from "@/lib/data/litellm/team-links";
import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import {
  LTEAM,
  setToggles,
  stubLiteLLMEnv,
} from "@/test/fakes/fake-litellm-views";
import { ctxAt, ok } from "@/test/support/access-test-support";
import {
  MEMBER_A_LUSER,
  memberWritesHandler,
  send,
  setupMemberWritesSuite,
} from "@/test/support/litellm-member-writes-support";
import type { RouteHandler, Suite } from "@/test/fakes/fake-litellm-views";
import {
  PEOPLE,
  seedAdminScope,
  seedMember,
} from "@/test/support/matrix-route-support";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";
import { TEST_TABLE_NAME, putRaw, testDoc } from "@/test/support/test-support";

// Test-only harness for the M4 budget reset suites (not imported by production
// code). Rule 60.22: DynamoDB Local, the real policy module, audit and data
// layer; only `@/auth` (mocked by each test file) and the in-process fake
// LiteLLM are injected (Rule 60.24). Keys below are the ones the Data Model
// spec names ("Budget reset entities (unit M4)"), written out here rather than
// imported so the tests check the spec, not the code.
// Source: docs/specs/2026-11-10-litellm.md - "Budget reset requests" (MG-D8 to
// MG-D13); Access Control - "Permission matrix", BR1-BR10.

export { CALLERS, LTEAM, MEMBER_A_LUSER, PEOPLE, send, setToggles, signInAs };

export const REQUESTS = "/api/budget-reset-requests";
export const DAY_MS = 86_400_000;
export const NOW = "2026-11-14T10:00:00.000Z";
// A requester in a different team (team-c, dept-ops): the "other team" cases.
export const CARLA = PEOPLE.carol;

// ---- route loaders (the environment is stubbed, then the module imported) ---

export const loadRequests = async () => {
  stubLiteLLMEnv();
  return await import("@/app/api/budget-reset-requests/route");
};
export const loadMine = async () => {
  stubLiteLLMEnv();
  return (await import("@/app/api/budget-reset-requests/mine/route")).GET;
};
export const loadApprove = async () => {
  stubLiteLLMEnv();
  return (await import("@/app/api/budget-reset-requests/[id]/approve/route"))
    .POST;
};
export const loadDeny = async () => {
  stubLiteLLMEnv();
  return (await import("@/app/api/budget-reset-requests/[id]/deny/route")).POST;
};
export const loadNotifications = async () => {
  stubLiteLLMEnv();
  return await import("@/app/api/notifications/route");
};
export const loadMarkRead = async () => {
  stubLiteLLMEnv();
  return (await import("@/app/api/notifications/read/route")).POST;
};

// ---- suite setup -------------------------------------------------------------

// The L4 member-write world (four linked teams, memberA in team-a with a
// LiteLLM membership spend of 3.25 and a budget of 10) plus both toggles on.
// `resetMemberSpend` defaults off (LD10); the button path needs it on (MG-D11).
export function setupBudgetResetSuite(
  opts: { resetSpendOn?: boolean } = {},
): Suite {
  const state = setupMemberWritesSuite();
  beforeEach(async () => {
    if (opts.resetSpendOn !== false)
      await setToggles({ resetMemberSpend: true });
    // Scope grants and roles are made on known identities (Access Control -
    // identities); the recipients are read from them (MG-D13).
    for (const name of [
      "teamAdminA",
      "deptAdminEng",
      "orgAdmin",
      "admin",
      "auditor",
      "viewerNone",
    ] as const) {
      const c = CALLERS[name];
      await seedSeenRoles(c.oid, c.email, [...c.roles]);
    }
  });
  return state;
}

// Replace the fake with one whose write to `path` answers `status`.
export function failLiteLLMWrite(state: Suite, path: RegExp, status = 500) {
  const base = memberWritesHandler();
  state.fake = createFakeLiteLLM((call, attempt) =>
    path.test(call.path)
      ? { status, body: { error: "upstream boom" } }
      : base(call, attempt),
  );
  vi.stubGlobal("fetch", state.fake.fetch);
}
export const failResetSpend = (state: Suite, status = 500) =>
  failLiteLLMWrite(state, /\/reset_spend$/, status);

// ---- slice B: the ledger on the direct reset routes ------------------

// Registered by each reset route's own test file. Sources: LiteLLM spec -
// MG-D8 (one `BudgetReset` item per reset made through the dashboard, after
// LiteLLM confirms, the amount = the membership spend read just before the
// reset, `trigger` direct | request (no bulk; amended 2026-11-18), 400-day expiry; a failed reset writes none),
// MG-D9, Q5 (no limit on resets per member); Data Model - BudgetReset.
export function defineResetLedgerContract(
  state: Suite,
  spec: {
    operation: "spend" | "budget";
    action: string;
    writePath: RegExp;
    load: () => Promise<RouteHandler>;
    url: (team: string, oid: string) => string;
  },
) {
  const target = CALLERS.memberA.oid;
  const run = async (suffix = "", team = "team-a") =>
    send(await spec.load(), {
      method: "POST",
      path: `${spec.url(team, target)}${suffix}`,
      params: { teamId: team, oid: target },
    });

  describe(`${spec.action}: the BudgetReset ledger (MG-D8)`, () => {
    beforeEach(async () => {
      await setToggles({ resetMemberSpend: true, resetMemberBudget: true });
    });

    it("a direct reset writes one item with the amount read before the reset and a 400-day expiry", async () => {
      signInAs("teamAdminA");
      const { res } = await run();
      expect(res.status).toBe(200);
      const ledger = await ledgerOf("team-a");
      expect(ledger).toHaveLength(1);
      const item = ledger[0] ?? {};
      expect(item).toMatchObject({
        oid: target,
        teamId: "team-a",
        departmentId: "dept-eng",
        litellmTeamId: LTEAM["team-a"],
        litellmUserId: MEMBER_A_LUSER,
        operation: spec.operation,
        amount: 3.25,
        budget: 10,
        trigger: "direct",
        actorOid: CALLERS.teamAdminA.oid,
        timestamp: NOW,
        gsi1pk: `BRESETS#IDENT#${target}`,
      });
      expect(typeof item.requestId).toBe("string");
      expect(item.expiresAt).toBe(Date.parse(NOW) / 1000 + 400 * 86_400);
      const records = (await auditActions()).filter(
        (r) => r.action === spec.action,
      );
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ result: "success" });
    });

    it("the spend is read before the write (call order)", async () => {
      signInAs("admin");
      await run();
      const order = state.fake.calls.map((c) => `${c.method} ${c.path}`);
      const read = order.indexOf("GET /team/info");
      const write = order.findIndex((p) => p.startsWith("POST /team/"));
      expect(read).toBeGreaterThanOrEqual(0);
      expect(read).toBeLessThan(write);
    });

    // MG-D8 (amended 2026-11-18): there is no bulk trigger; the per-member
    // route is always `direct` and never reads a client trigger parameter.
    it("?trigger=bulk from a client is ignored: recorded as direct (MG-D8, amended 2026-11-18)", async () => {
      signInAs("orgAdmin");
      await run("?trigger=bulk");
      expect((await ledgerOf("team-a")).map((i) => i.trigger)).toEqual([
        "direct",
      ]);
    });

    it("a caller cannot forge another trigger: ?trigger=request is recorded as direct (only an approval is `request`)", async () => {
      signInAs("admin");
      const { res } = await run("?trigger=request");
      if (res.status === 200) {
        expect((await ledgerOf("team-a")).map((i) => i.trigger)).toEqual([
          "direct",
        ]);
      } else {
        expect(res.status).toBe(400);
        expect(await ledgerOf("team-a")).toEqual([]);
      }
    });

    it("every reset is an item: two resets of one member leave two (no limit, user Q5)", async () => {
      signInAs("admin");
      await run();
      await run();
      expect(await ledgerOf("team-a")).toHaveLength(2);
    });

    it("a LiteLLM failure writes no item (the reset did not happen)", async () => {
      failLiteLLMWrite(state, spec.writePath);
      signInAs("admin");
      const { res } = await run();
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(await ledgerOf("team-a")).toEqual([]);
    });

    // MG-D8 / Rule 60.17: LiteLLM already reset the member, so a ledger write
    // that fails must surface (500, no success audit, no item), never a 200.
    it("a failed ledger write is not swallowed: 500, no item and no success audit", async () => {
      // Load the route first: loading resets the module registry, and the
      // spy must sit on the client the route will use.
      const handler = await spec.load();
      const { getDocumentClient } = await import("@/lib/dynamodb");
      const client = getDocumentClient();
      const real = client.send.bind(client) as (c: unknown) => Promise<unknown>;
      const spy = vi
        .spyOn(client, "send")
        .mockImplementation(((command: { input?: unknown }) =>
          JSON.stringify(command.input ?? {}).includes("BRESET#")
            ? Promise.reject(new Error("ledger write failed"))
            : real(command)) as never);
      try {
        signInAs("admin");
        const { res } = await send(handler, {
          method: "POST",
          path: spec.url("team-a", target),
          params: { teamId: "team-a", oid: target },
        });
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      expect(await ledgerOf("team-a")).toEqual([]);
      expect(
        (await auditActions()).filter(
          (r) => r.action === spec.action && r.result === "success",
        ),
      ).toEqual([]);
    });

    it.each([
      ["a plain member (403)", "memberA", "team-a"],
      ["an Auditor (403)", "auditor", "team-a"],
      ["a Lead outside the team (404)", "teamAdminA", "team-b"],
    ] as const)("%s writes no item", async (_n, who, team) => {
      signInAs(who);
      const { res } = await run("", team);
      expect([403, 404]).toContain(res.status);
      expect(await ledgerOf("team-a")).toEqual([]);
      expect(await ledgerOf("team-b")).toEqual([]);
    });

    it("a disabled operation writes no item", async () => {
      await setToggles({ resetMemberSpend: false, resetMemberBudget: false });
      signInAs("admin");
      const { res } = await run();
      expect(res.status).toBe(403);
      expect(await ledgerOf("team-a")).toEqual([]);
    });
  });
}

// ---- slice B: a seeded ledger for the count suites -------------------------------

export const RANGE_Q = "dateFrom=2026-11-01&dateTo=2026-11-14";

const ledgerItem = (
  teamId: string,
  departmentId: string,
  oid: string,
  timestamp: string,
  amount: number,
  n: number,
) => {
  const resetId = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const SK = `${timestamp}#${resetId}`;
  return {
    PK: `BRESET#TEAM#${teamId}`,
    SK,
    gsi1pk: `BRESETS#IDENT#${oid}`,
    gsi1sk: SK,
    resetId,
    oid,
    teamId,
    departmentId,
    litellmTeamId: `lt-${teamId}`,
    litellmUserId: `${oid}@company.com`,
    operation: "spend",
    amount,
    budget: 10,
    trigger: "direct",
    actorOid: CALLERS.admin.oid,
    requestId: `req-${n}`,
    timestamp,
    expiresAt: Math.floor(Date.parse(timestamp) / 1000) + 400 * 86_400,
  };
};

// team-a: memberA 2 resets (3.25 and 4, the second on the last second of the
// range's final day), alice 1 (5); team-b: memberB 1 (2); team-c: carol 1 (7).
// Two memberA resets sit just outside 2026-11-01..2026-11-14 and must not count.
export async function seedLedger() {
  const rows = [
    ledgerItem(
      "team-a",
      "dept-eng",
      CALLERS.memberA.oid,
      "2026-11-02T08:00:00.000Z",
      3.25,
      1,
    ),
    ledgerItem(
      "team-a",
      "dept-eng",
      CALLERS.memberA.oid,
      "2026-11-14T23:59:59.999Z",
      4,
      2,
    ),
    ledgerItem(
      "team-a",
      "dept-eng",
      PEOPLE.alice.oid,
      "2026-11-05T09:00:00.000Z",
      5,
      3,
    ),
    ledgerItem(
      "team-b",
      "dept-eng",
      CALLERS.memberB.oid,
      "2026-11-03T09:00:00.000Z",
      2,
      4,
    ),
    ledgerItem(
      "team-c",
      "dept-ops",
      PEOPLE.carol.oid,
      "2026-11-04T09:00:00.000Z",
      7,
      5,
    ),
    ledgerItem(
      "team-a",
      "dept-eng",
      CALLERS.memberA.oid,
      "2026-10-31T23:59:59.999Z",
      100,
      6,
    ),
    ledgerItem(
      "team-a",
      "dept-eng",
      CALLERS.memberA.oid,
      "2026-11-15T00:00:00.000Z",
      100,
      7,
    ),
  ];
  for (const row of rows) await putRaw(row);
}

// ---- people --------------------------------------------------------------------

export async function makeMember(oid: string, teamId: string) {
  await seedMember(oid, teamId);
}

// Identity items carry the last-seen roles the fallback recipients are read
// from (MG-D13: stored grant or last-seen role).
export async function seedSeenRoles(
  oid: string,
  email: string,
  roles: string[],
) {
  await putRaw({
    PK: `IDENT#${oid}`,
    SK: "META",
    gsi1pk: "IDENTS",
    gsi1sk: `IDENT#${oid}`,
    oid,
    tid: "00000000-0000-4000-8000-0000000000ff",
    email,
    displayName: email.split("@")[0] ?? oid,
    lastSignInAt: "2026-11-01T00:00:00.000Z",
    lastSeenRoles: roles,
    authMethod: "entra",
    version: 1,
  });
}

// ---- requests ------------------------------------------------------------------

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function createRequest(
  as: Parameters<typeof signInAs>[0] = "memberA",
  reason?: string,
): Promise<{ status: number; body: Body; id: string }> {
  signInAs(as);
  const { POST } = await loadRequests();
  const { res, body } = await send(POST, {
    method: "POST",
    path: REQUESTS,
    params: {},
    body: reason === undefined ? {} : { reason },
  });
  return { status: res.status, body, id: String(body.data?.id ?? "") };
}

export async function decide(
  as: Parameters<typeof signInAs>[0],
  id: string,
  verb: "approve" | "deny",
) {
  signInAs(as);
  const post = verb === "approve" ? await loadApprove() : await loadDeny();
  const { res, body, text } = await send(post, {
    method: "POST",
    path: `${REQUESTS}/${id}/${verb}`,
    params: { id },
  });
  return { status: res.status, body, text, res };
}

export async function listRequests(
  as: Parameters<typeof signInAs>[0],
  teamId: string,
  status: "open" | "all" = "open",
) {
  signInAs(as);
  const { GET } = await loadRequests();
  const { res, body, text } = await send(GET, {
    method: "GET",
    path: `${REQUESTS}?teamId=${teamId}&status=${status}`,
    params: {},
  });
  return { status: res.status, body, text, res };
}

export async function mineOf(as: Parameters<typeof signInAs>[0]) {
  signInAs(as);
  const GET = await loadMine();
  const { res, body } = await send(GET, {
    method: "GET",
    path: `${REQUESTS}/mine`,
    params: {},
  });
  return { status: res.status, body };
}

export async function notificationsOf(as: Parameters<typeof signInAs>[0]) {
  signInAs(as);
  const { GET } = await loadNotifications();
  const { res, body, text } = await send(GET, {
    method: "GET",
    path: "/api/notifications",
    params: {},
  });
  return { status: res.status, body, text };
}

// ---- table reads (keys as the Data Model spec names them) -----------------------

async function queryPk(pk: string): Promise<Record<string, unknown>[]> {
  const res = await testDoc().send(
    new QueryCommand({
      TableName: TEST_TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": pk },
    }),
  );
  return res.Items ?? [];
}

export const ledgerOf = (teamId: string) => queryPk(`BRESET#TEAM#${teamId}`);
export const notifRowsOf = (oid: string) => queryPk(`NOTIF#${oid}`);
export const claimOf = (teamId: string, oid: string) =>
  queryPk(`BRREQOPEN#${teamId}#${oid}`);
export const requestRow = async (id: string) =>
  (await queryPk(`BRREQ#${id}`))[0];

export const kindsOf = (
  rows: Record<string, any>[], // eslint-disable-line @typescript-eslint/no-explicit-any
) => rows.map((r) => String(r.kind)).sort();

export async function auditActions(day = "2026-11-14") {
  const { listAuditRecords } = await import("@/lib/data/access/audit");
  return await listAuditRecords(day);
}

// ---- changes between request and decision (BR4) ----------------------------------

export async function revokeLeadScope(
  oid: string,
  scopeType: "team" | "department",
  scopeId: string,
) {
  ok(
    await revokeAdminScope(
      { oid, scopeType, scopeId, version: 1 },
      ctxAt(undefined, "req-revoke"),
    ),
  );
}

export async function grantLeadScope(
  oid: string,
  scopeType: "team" | "department",
  scopeId: string,
) {
  await seedAdminScope(oid, scopeType, scopeId);
}

export async function unlinkTeam(teamId: string) {
  await deleteTeamLink(teamId, ctxAt(undefined, "req-unlink"));
}

export const memberALusers = {
  oid: CALLERS.memberA.oid,
  litellmUserId: MEMBER_A_LUSER,
  litellmTeamId: LTEAM["team-a"],
};
