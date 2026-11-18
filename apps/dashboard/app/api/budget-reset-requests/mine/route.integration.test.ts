import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  DAY_MS,
  NOW,
  createRequest,
  decide,
  makeMember,
  mineOf,
  setToggles,
  setupBudgetResetSuite,
  unlinkTeam,
} from "@/test/support/budget-reset-support";

// Sources: Data Model - API Routes (`GET /api/budget-reset-requests/mine`: any
// signed-in role, own data only; `eligibility` { canRequest, reason } with
// reason in no-team | not-linked | disabled | open-request | null, `open`,
// `recent` at most 10); LiteLLM spec - "Budget reset requests" and MG-D11
// ("the control is absent on an unlinked team and whenever requestBudgetReset
// or resetMemberSpend is off" - hidden, never dead); Access Control - role x
// operation table (`mine`: every role, own data only); BR5.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

setupBudgetResetSuite();

describe("GET /api/budget-reset-requests/mine: eligibility", () => {
  it("a member of a linked team with both toggles on can request", async () => {
    const { status, body } = await mineOf("memberA");
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      teamId: "team-a",
      eligibility: { canRequest: true, reason: null },
      open: null,
      recent: [],
    });
  });

  it.each(["viewerNone", "admin", "orgAdmin", "teamAdminA"] as const)(
    "%s with no member team: canRequest false, reason no-team, no team id",
    async (who) => {
      const { status, body } = await mineOf(who);
      expect(status).toBe(200);
      expect(body.data).toMatchObject({
        teamId: null,
        eligibility: { canRequest: false, reason: "no-team" },
        open: null,
        recent: [],
      });
    },
  );

  it("a member of an unlinked team: not-linked", async () => {
    await makeMember(CALLERS.viewerNone.oid, "team-u");
    const { body } = await mineOf("viewerNone");
    expect(body.data.eligibility).toEqual({
      canRequest: false,
      reason: "not-linked",
    });
  });

  it("a team whose LiteLLM link was removed is not-linked", async () => {
    await unlinkTeam("team-a");
    const { body } = await mineOf("memberA");
    expect(body.data.eligibility.canRequest).toBe(false);
    expect(body.data.eligibility.reason).toBe("not-linked");
  });

  it.each([
    [
      "requestBudgetReset off",
      { resetMemberSpend: true, requestBudgetReset: false },
    ],
    ["resetMemberSpend off", { resetMemberSpend: false }],
    ["resetMemberSpend never enabled (LD10 default)", {}],
  ])("disabled when %s", async (_name, toggles) => {
    await setToggles(toggles);
    const { body } = await mineOf("memberA");
    expect(body.data.eligibility).toEqual({
      canRequest: false,
      reason: "disabled",
    });
  });

  it("an Auditor who is a member of a linked team cannot request (read-only role)", async () => {
    await makeMember(CALLERS.auditor.oid, "team-a");
    const { status, body } = await mineOf("auditor");
    expect(status).toBe(200);
    expect(body.data.eligibility.canRequest).toBe(false);
  });

  it("an Admin who is a member of a linked team can request", async () => {
    await makeMember(CALLERS.admin.oid, "team-a");
    const { body } = await mineOf("admin");
    expect(body.data.eligibility).toEqual({ canRequest: true, reason: null });
  });
});

describe("GET /api/budget-reset-requests/mine: own requests only (BR5)", () => {
  it("an open request is returned as `open` and blocks another (open-request)", async () => {
    const made = await createRequest("memberA", "need budget");
    const { body } = await mineOf("memberA");
    expect(body.data.eligibility).toEqual({
      canRequest: false,
      reason: "open-request",
    });
    expect(body.data.open).toMatchObject({
      id: made.id,
      status: "open",
      reason: "need budget",
      requestExpiresAt: new Date(Date.parse(NOW) + 7 * DAY_MS).toISOString(),
    });
    expect(body.data.recent).toEqual([]);
  });

  it("a decided request moves to `recent` and the person can ask again", async () => {
    const made = await createRequest("memberA");
    await decide("admin", made.id, "deny");
    const { body } = await mineOf("memberA");
    expect(body.data.open).toBeNull();
    expect(body.data.eligibility.canRequest).toBe(true);
    expect(body.data.recent.map((r: { id: string }) => r.id)).toEqual([
      made.id,
    ]);
    expect(body.data.recent[0].status).toBe("denied");
  });

  it("never returns another person's request, even on the same team", async () => {
    await makeMember(CALLERS.admin.oid, "team-a");
    const others = await createRequest("admin", "ADMIN-ONLY-REASON");
    expect(others.status).toBe(201);
    const { body } = await mineOf("memberA");
    expect(body.data.open).toBeNull();
    expect(body.data.recent).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("ADMIN-ONLY-REASON");
  });

  it("keeps at most the 10 most recent decided requests", async () => {
    for (let i = 0; i < 11; i += 1) {
      vi.setSystemTime(new Date(Date.parse(NOW) + i * 1000));
      const made = await createRequest("memberA", `r${i}`);
      await decide("admin", made.id, "deny");
    }
    const { body } = await mineOf("memberA");
    expect(body.data.recent).toHaveLength(10);
    expect(body.data.recent[0].reason).toBe("r10");
  });
});
