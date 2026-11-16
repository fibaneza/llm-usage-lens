import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  LTEAM,
  MEMBER_A_LUSER,
  bodyOf,
  defineMemberWriteContract,
  expectError,
  memberAudit,
  send,
  setupMemberWritesSuite,
  signInAs,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/litellm-member-writes-support";

// Contract for the developer: see the header of each describe below. Shared
// role x operation, toggle, outage, scope-404 and unlinked cases come from
// defineMemberWriteContract; the 401/403-before-parse/400/no-store/denied
// cases of every route are the shared route-contract suite's (Rule 60.23).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupMemberWritesSuite();

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (setMemberLimits: POST
// /team/member_update with team_id, user_id, rpm_limit, tpm_limit only; Lead +
// Admin; audit litellmUserId before/after), "Budgets and limits" (limits are
// positive integers or unset - omitted, never 0; a member limit above the
// team's is 400 with no LiteLLM call), LT10, LT13.
//
// Contract: PATCH .../members/[oid]/limits, strict body
//   { rpmLimit?: positive integer, tpmLimit?: positive integer }, at least one.
//   Only the fields given are sent (unset fields are omitted, never 0/null).
//   200 { data: { oid, litellmUserId, rpmLimit?, tpmLimit? } }; audit
//   litellm.member.limits, before/after { rpmLimit?, tpmLimit? }.
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).PATCH;
};
const PATTERN = "/api/litellm/teams/[teamId]/members/[oid]/limits";
const url = (team: string, oid: string) =>
  `/api/litellm/teams/${team}/members/${oid}/limits`;

defineMemberWriteContract(state, {
  method: "PATCH",
  pattern: PATTERN,
  action: "litellm.member.limits",
  toggleOp: "setMemberLimits",
  okStatus: 200,
  load,
  path: url,
  body: { rpmLimit: 30 },
});

describe("PATCH /api/litellm/teams/[teamId]/members/[oid]/limits", () => {
  const patch = async (payload: unknown, oid = CALLERS.memberA.oid) =>
    send(await load(), {
      method: "PATCH",
      path: url("team-a", oid),
      params: { teamId: "team-a", oid },
      body: payload,
    });

  it("sends only the limit given - the unset one is omitted, never 0 or null - and audits before/after (LT10; Writes)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await patch({ rpmLimit: 30 });
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      oid: CALLERS.memberA.oid,
      litellmUserId: MEMBER_A_LUSER,
      rpmLimit: 30,
    });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(bodyOf(writes[0])).toEqual({
      team_id: LTEAM["team-a"],
      user_id: MEMBER_A_LUSER,
      rpm_limit: 30,
    });
    const [record] = await memberAudit();
    expect(record).toMatchObject({
      action: "litellm.member.limits",
      result: "success",
      target: { type: "litellm-user", id: MEMBER_A_LUSER },
      before: { rpmLimit: 5 },
      after: { rpmLimit: 30 },
    });
  });

  it("sends both limits when both are given", async () => {
    signInAs("admin");
    const { res } = await patch({ rpmLimit: 10, tpmLimit: 1000 });
    expect(res.status).toBe(200);
    expect(bodyOf(writeCalls(state)[0])).toMatchObject({
      rpm_limit: 10,
      tpm_limit: 1000,
    });
  });

  it.each([
    ["rpmLimit", 60, 200],
    ["rpmLimit", 61, 400],
    ["tpmLimit", 6000, 200],
    ["tpmLimit", 6001, 400],
  ])(
    "%s of %i against the team's 60 rpm / 6000 tpm is %i; above the team's is refused with no LiteLLM write (LT13)",
    async (field, amount, status) => {
      signInAs("admin");
      const { res } = await patch({ [field]: amount });
      expect(res.status).toBe(status);
      if (status === 400) {
        await expectError(res, 400, "BAD_REQUEST");
        expect(writeCalls(state)).toHaveLength(0);
      }
    },
  );

  it.each([
    ["zero (LiteLLM may read 0 as block)", { rpmLimit: 0 }],
    ["a negative limit", { tpmLimit: -5 }],
    ["a fractional limit", { rpmLimit: 1.5 }],
    ["a string limit", { rpmLimit: "5" }],
    ["null (unset means omitted)", { rpmLimit: null }],
    ["an empty body (nothing to change)", {}],
    ["an unknown field (strict body)", { rpmLimit: 5, maxBudgetInTeam: 1 }],
  ])(
    "%s is 400 BAD_REQUEST with no LiteLLM write (LT10; Budgets and limits)",
    async (_n, payload) => {
      signInAs("admin");
      await expectError((await patch(payload)).res, 400, "BAD_REQUEST");
      expect(writeCalls(state)).toHaveLength(0);
    },
  );
});
