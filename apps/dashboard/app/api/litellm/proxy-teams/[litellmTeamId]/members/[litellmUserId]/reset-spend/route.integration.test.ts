import { describe, expect, it, vi } from "vitest";

import {
  LTEAM,
  LU,
  bodyOf,
  defineProxyMemberResetContract,
  send,
  setToggles,
  setupIdWritesSuite,
  signInAs,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/support/litellm-id-writes-support";

// Source: docs/specs/2026-11-10-litellm.md - LD39, "Writes" (resetMemberSpend:
// POST /team/{team_id}/member/{user_id}/reset_spend, body reset_to 0; toggle
// default OFF, LD10), "API routes" (RS2 write routes: order, 404, 409); plan
// RS2 D-RS3..D-RS5, D-RS8, T-RS3..T-RS6. The 401/403-before-parse/400/no-store/
// denied cases are the shared route-contract suite's (Rule 60.23).
//
// Contract for the developer: POST
// app/api/litellm/proxy-teams/[litellmTeamId]/members/[litellmUserId]/reset-spend/route.ts,
// no body; exports POST. 200 { data: { litellmUserId, ... } }; exactly one
// write POST /team/{litellmTeamId}/member/{litellmUserId}/reset_spend with
// body { reset_to: 0 }; audit litellm.member.reset-spend.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupIdWritesSuite();
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).POST;
};

defineProxyMemberResetContract(state, {
  operation: "spend",
  action: "litellm.member.reset-spend",
  toggleOp: "resetMemberSpend",
  defaultOff: true,
  suffix: "reset-spend",
  upstream: "reset_spend",
  load,
});

describe("POST /api/litellm/proxy-teams/[litellmTeamId]/members/[litellmUserId]/reset-spend (D-RS4)", () => {
  it("sends reset_to 0 for exactly that member of that LiteLLM team and nothing else (Writes: resetMemberSpend)", async () => {
    await setToggles({ resetMemberSpend: true });
    signInAs("teamAdminA");
    const { res } = await send(
      await load(),
      `/api/litellm/proxy-teams/${LTEAM["team-a"]}/members/${LU.ab}/reset-spend`,
      { litellmTeamId: LTEAM["team-a"], litellmUserId: LU.ab },
    );
    expect(res.status).toBe(200);
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(bodyOf(writes[0])).toEqual({ reset_to: 0 });
  });
});
