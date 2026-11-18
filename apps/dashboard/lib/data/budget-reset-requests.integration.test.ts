import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Scope } from "@/lib/auth/policy";
import type { WriteActor } from "@/lib/auth/write-policy";
import { ctxAt, NOW, OID_A, OID_B } from "@/test/support/access-test-support";
import {
  clearTable,
  ensureTestTable,
  putRaw,
} from "@/test/support/test-support";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

import {
  abortApproval,
  beginApproval,
  createBudgetResetRequest,
  denyBudgetResetRequest,
  getBudgetResetRequest,
  getOpenRequestFor,
  listTeamBudgetResetRequests,
  mayDecide,
  mayReadRequest,
  mayRequestBudgetReset,
} from "./budget-reset-requests";

// Sources: docs/specs/2026-11-10-litellm.md - "Budget reset requests" (Flow
// 3-5; MG-D12 who decides, MG-D12a the approving state), Data Model - "Budget
// reset entities (unit M4)"; Access Control - "Permission matrix" -> "Budget
// reset requests" and BR1 (no widening), BR2 (self), BR3 (one winner), BR6
// (one open request, 7-day expiry), BR8 (read follows scope), residual risk
// "Budget reset stuck in approving". Route-level outcomes are in
// app/api/budget-reset-requests/**; this file holds the state machine and the
// pure decisions only (Rule 60.24a, one layer per behaviour).
const REQUESTER = OID_A;
const OTHER = OID_B;
const DAY_MS = 86_400_000;
const input = {
  requesterOid: REQUESTER,
  teamId: "team-a",
  departmentId: "dept-eng",
  litellmTeamId: "lt-team-a",
  reason: null,
};
const ADMIN = "00000000-0000-4000-8000-0000000000a1";

let seq = 0;
const ctx = (now: Date = NOW) => ctxAt(now, `req-${(seq += 1)}`);

const open = async () => {
  const made = await createBudgetResetRequest(input, ctx());
  if (!made.ok) throw new Error(made.code);
  return made.value;
};

beforeAll(ensureTestTable);
beforeEach(clearTable);

describe("request lifecycle (MG-D12a, BR3)", () => {
  it("a created request is open, expires in exactly 7 days and is the person's open request", async () => {
    const request = await open();
    expect(request.status).toBe("open");
    expect(
      Date.parse(request.requestExpiresAt) - Date.parse(request.createdAt),
    ).toBe(7 * DAY_MS);
    expect((await getOpenRequestFor("team-a", REQUESTER, NOW))?.requestId).toBe(
      request.requestId,
    );
  });

  it("a second create by the same person for the same team is CONFLICT; another person or team is allowed (BR6)", async () => {
    await open();
    expect(await createBudgetResetRequest(input, ctx())).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(
      (await createBudgetResetRequest({ ...input, requesterOid: OTHER }, ctx()))
        .ok,
    ).toBe(true);
    expect(
      (await createBudgetResetRequest({ ...input, teamId: "team-b" }, ctx()))
        .ok,
    ).toBe(true);
  });

  it("open -> approving is conditional: the second begin loses with CONFLICT (BR3)", async () => {
    const request = await open();
    const [a, b] = await Promise.all([
      beginApproval(request, ADMIN, NOW),
      beginApproval(request, ADMIN, NOW),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect((await getBudgetResetRequest(request.requestId, NOW))?.status).toBe(
      "approving",
    );
  });

  it('approving still holds the person\'s claim ("Processing"; no second request) and a deny of it is CONFLICT (MG-D12a, residual risk: stuck in approving)', async () => {
    const request = await open();
    const begun = await beginApproval(request, ADMIN, NOW);
    expect(begun.ok).toBe(true);
    expect((await getOpenRequestFor("team-a", REQUESTER, NOW))?.status).toBe(
      "approving",
    );
    expect(await createBudgetResetRequest(input, ctx())).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    const denied = await denyBudgetResetRequest(request, ADMIN, ctx());
    expect(denied).toEqual({ ok: false, code: "CONFLICT" });
    expect((await getBudgetResetRequest(request.requestId, NOW))?.status).toBe(
      "approving",
    );
  });

  it("a stuck approving request is not expired by reading it, even long after 7 days (it is not reopened automatically)", async () => {
    const request = await open();
    await beginApproval(request, ADMIN, NOW);
    const later = new Date(NOW.getTime() + 30 * DAY_MS);
    expect(
      (await getBudgetResetRequest(request.requestId, later))?.status,
    ).toBe("approving");
  });

  it("abortApproval returns approving to open, clears the decider and lets it be approved again (MG-D12a)", async () => {
    const request = await open();
    const begun = await beginApproval(request, ADMIN, NOW);
    if (!begun.ok) throw new Error("begin");
    await abortApproval(begun.value);
    const back = await getBudgetResetRequest(request.requestId, NOW);
    expect(back).toMatchObject({
      status: "open",
      decidedBy: null,
      decidedAt: null,
    });
    expect((await beginApproval(back ?? request, ADMIN, NOW)).ok).toBe(true);
  });

  it("deny moves open to denied once; a second deny is CONFLICT and the person may ask again", async () => {
    const request = await open();
    const first = await denyBudgetResetRequest(request, ADMIN, ctx());
    expect(first.ok).toBe(true);
    expect(await denyBudgetResetRequest(request, ADMIN, ctx())).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect((await createBudgetResetRequest(input, ctx())).ok).toBe(true);
  });
});

describe("7-day expiry (BR6; Flow 5)", () => {
  it("is open just before requestExpiresAt and expired at it (a due request is not open)", async () => {
    const request = await open();
    const due = Date.parse(request.requestExpiresAt);
    expect(
      (await getBudgetResetRequest(request.requestId, new Date(due - 1)))
        ?.status,
    ).toBe("open");
    expect(
      (await getBudgetResetRequest(request.requestId, new Date(due)))?.status,
    ).toBe("expired");
  });

  it("a stale claim does not block a new request once the old one has expired", async () => {
    await open();
    const later = ctx(new Date(NOW.getTime() + 7 * DAY_MS + 1000));
    expect((await createBudgetResetRequest(input, later)).ok).toBe(true);
  });

  // Review m4-r1 Q-B1: R1 expires unread, R2 takes the person's claim, then R1
  // is read. R1 must still move to expired (the claim is R2's, so it is
  // treated as released), never stay open and approvable (BR3, BR6, MG-D12a).
  describe("an expired request whose claim now belongs to a newer request (review m4-r1 Q-B1; BR6)", () => {
    const afterExpiry = new Date(NOW.getTime() + 7 * DAY_MS + 1000);
    const setup = async () => {
      const r1 = await open();
      const second = await createBudgetResetRequest(input, ctx(afterExpiry));
      if (!second.ok) throw new Error(second.code);
      return { r1, r2: second.value };
    };

    it("R1 reads as expired and R2's claim is left in place", async () => {
      const { r1, r2 } = await setup();
      expect(
        (await getBudgetResetRequest(r1.requestId, afterExpiry))?.status,
      ).toBe("expired");
      expect(
        (await getOpenRequestFor("team-a", REQUESTER, afterExpiry))?.requestId,
      ).toBe(r2.requestId);
    });

    it("the open list holds only R2", async () => {
      const { r2 } = await setup();
      const page = await listTeamBudgetResetRequests("team-a", {
        status: "open",
        cursorSecret: "test-secret",
        now: afterExpiry,
      });
      if (!page.ok) throw new Error(page.code);
      expect(page.value.items.map((r) => r.requestId)).toEqual([r2.requestId]);
    });

    it("beginApproval refuses an expired request even from a stale open copy (CONFLICT)", async () => {
      const { r1 } = await setup();
      expect(await beginApproval(r1, ADMIN, afterExpiry)).toEqual({
        ok: false,
        code: "CONFLICT",
      });
    });

    it("beginApproval refuses a request that is due but was never read (no lazy expiry needed)", async () => {
      const r1 = await open();
      expect(await beginApproval(r1, ADMIN, afterExpiry)).toEqual({
        ok: false,
        code: "CONFLICT",
      });
    });
  });

  it("a request that is missing is null, not an error", async () => {
    expect(
      await getBudgetResetRequest("00000000-0000-4000-8000-00000000dead"),
    ).toBeNull();
  });
});

describe("stored data is validated on read (Rule 20.13 spirit; Rule 60.16)", () => {
  it("a corrupt request item fails the read instead of being shown", async () => {
    await putRaw({
      PK: "BRREQ#00000000-0000-4000-8000-0000000000c1",
      SK: "META",
      requestId: "00000000-0000-4000-8000-0000000000c1",
      status: "bogus",
    });
    await expect(
      getBudgetResetRequest("00000000-0000-4000-8000-0000000000c1", NOW),
    ).rejects.toThrow();
  });
});

describe("mayDecide: the member write of the reset routes minus the requester (BR1, BR2; Permission matrix)", () => {
  const request = { ...input, requesterOid: REQUESTER } as Parameters<
    typeof mayDecide
  >[1];
  const team = { teamId: "team-a", departmentId: "dept-eng" };
  const actor = (
    over: Partial<WriteActor> & { oid?: string } = {},
  ): WriteActor => ({
    oid: ADMIN,
    roles: [],
    teamScopes: new Set(),
    departmentScopes: new Set(),
    ...over,
  });

  it.each([
    ["internal-admin", { roles: ["internal-admin"] }, true],
    ["internal-org-admin", { roles: ["internal-org-admin"] }, true],
    ["team Lead of the team", { teamScopes: new Set(["team-a"]) }, true],
    [
      "department Lead of its department",
      { departmentScopes: new Set(["dept-eng"]) },
      true,
    ],
    ["team Lead of another team", { teamScopes: new Set(["team-b"]) }, false],
    [
      "department Lead of another department",
      { departmentScopes: new Set(["dept-ops"]) },
      false,
    ],
    ["auditor only", { roles: ["internal-auditor"] }, false],
    ["no role, no scope", {}, false],
  ] as const)("%s -> %s", (_n, over, expected) => {
    expect(mayDecide(actor(over as Partial<WriteActor>), request, team)).toBe(
      expected,
    );
  });

  it.each([
    { roles: ["internal-admin"] },
    { roles: ["internal-org-admin"] },
    { teamScopes: new Set(["team-a"]) },
    { departmentScopes: new Set(["dept-eng"]) },
  ] as const)(
    "never the requester's own request, whatever the authority (BR2)",
    (over) => {
      expect(
        mayDecide(
          actor({ ...(over as Partial<WriteActor>), oid: REQUESTER }),
          request,
          team,
        ),
      ).toBe(false);
    },
  );

  it("a team that no longer exists is not decidable by a Lead", () => {
    expect(
      mayDecide(actor({ teamScopes: new Set(["team-a"]) }), request, null),
    ).toBe(false);
  });
});

describe("mayRequestBudgetReset: the Auditor stays read-only (Permission matrix, POST column Auditor)", () => {
  const withRoles = (roles: WriteActor["roles"]): WriteActor => ({
    oid: ADMIN,
    roles,
    teamScopes: new Set(),
    departmentScopes: new Set(),
  });
  it.each([
    [[], true],
    [["internal-auditor"], false],
    [["internal-admin", "internal-auditor"], true],
    [["internal-org-admin", "internal-auditor"], true],
  ] as const)("roles %j -> %s", (roles, expected) => {
    expect(mayRequestBudgetReset(withRoles(roles))).toBe(expected);
  });
  it("no identity never requests", () => {
    expect(mayRequestBudgetReset(null)).toBe(false);
  });
});

describe("mayReadRequest: shown to its requester and to whoever's scope covers it (BR8)", () => {
  const request = { ...input, requesterOid: REQUESTER } as Parameters<
    typeof mayReadRequest
  >[1];
  const scope = (over: Partial<Scope> = {}): Scope =>
    ({
      authenticated: true,
      global: false,
      teamScopes: new Set(),
      departmentScopes: new Set(),
      ...over,
    }) as Scope;

  it.each([
    ["global", { global: true }, true],
    ["its team", { teamScopes: new Set(["team-a"]) }, true],
    ["its department", { departmentScopes: new Set(["dept-eng"]) }, true],
    ["another team", { teamScopes: new Set(["team-b"]) }, false],
    ["another department", { departmentScopes: new Set(["dept-ops"]) }, false],
    ["nothing", {}, false],
  ] as const)("a caller with %s scope -> %s", (_n, over, expected) => {
    expect(mayReadRequest(scope(over as Partial<Scope>), request, OTHER)).toBe(
      expected,
    );
  });

  it("the requester always reads their own request, with no scope", () => {
    expect(mayReadRequest(scope(), request, REQUESTER)).toBe(true);
  });
});
