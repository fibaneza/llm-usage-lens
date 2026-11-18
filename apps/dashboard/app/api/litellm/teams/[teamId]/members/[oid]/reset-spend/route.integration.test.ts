import { describe, expect, it, vi } from "vitest";

import { defineResetLedgerContract } from "@/test/support/budget-reset-support";
import {
  CALLERS,
  LTEAM,
  MEMBER_A_LUSER,
  bodyOf,
  defineMemberWriteContract,
  expectError,
  memberAudit,
  send,
  setToggles,
  setupMemberWritesSuite,
  signInAs,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/support/litellm-member-writes-support";

// Contract for the developer: see the header of each describe below. Shared
// role x operation, toggle, outage, scope-404 and unlinked cases come from
// defineMemberWriteContract; the 401/403-before-parse/400/no-store/denied
// cases of every route are the shared route-contract suite's (Rule 60.23).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupMemberWritesSuite();

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (resetMemberSpend: POST
// /team/{team_id}/member/{user_id}/reset_spend, body reset_to 0; Lead + Admin;
// toggle default OFF (LD10, destructive); audit litellmUserId, spend before),
// "Budgets and limits" (acts on exactly one member of one team), "Gateway
// guardrails" item 2 (path parameters encoded).
//
// Contract: POST .../members/[oid]/reset-spend, no body. 200
//   { data: { oid, litellmUserId } }; exactly one write; audit
//   litellm.member.reset-spend, before { spend: <current> }, after { spend: 0 }.
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).POST;
};
const PATTERN = "/api/litellm/teams/[teamId]/members/[oid]/reset-spend";
const url = (team: string, oid: string) =>
  `/api/litellm/teams/${team}/members/${oid}/reset-spend`;

defineMemberWriteContract(state, {
  method: "POST",
  pattern: PATTERN,
  action: "litellm.member.reset-spend",
  toggleOp: "resetMemberSpend",
  defaultOff: true,
  okStatus: 200,
  load,
  path: url,
});

defineResetLedgerContract(state, {
  operation: "spend",
  action: "litellm.member.reset-spend",
  writePath: /\/reset_spend$/,
  load,
  url,
});

describe("POST /api/litellm/teams/[teamId]/members/[oid]/reset-spend", () => {
  const reset = async () =>
    send(await load(), {
      method: "POST",
      path: url("team-a", CALLERS.memberA.oid),
      params: { teamId: "team-a", oid: CALLERS.memberA.oid },
    });

  it("is off by default: 403 OPERATION_DISABLED before any LiteLLM call (LD10 destructive default)", async () => {
    signInAs("admin");
    await expectError((await reset()).res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("once switched on, resets exactly one member of one team to 0 and audits the spend before (Writes)", async () => {
    await setToggles({ resetMemberSpend: true });
    signInAs("teamAdminA");
    const { res, body } = await reset();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      oid: CALLERS.memberA.oid,
      litellmUserId: MEMBER_A_LUSER,
    });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe("POST");
    expect(writes[0]?.path).toBe(
      `/team/${LTEAM["team-a"]}/member/${encodeURIComponent(MEMBER_A_LUSER)}/reset_spend`,
    );
    expect(bodyOf(writes[0])).toEqual({ reset_to: 0 });
    const [record] = await memberAudit();
    expect(record).toMatchObject({
      action: "litellm.member.reset-spend",
      result: "success",
      target: { type: "litellm-user", id: MEMBER_A_LUSER },
      before: { spend: 3.25 },
      after: { spend: 0 },
    });
  });
});
