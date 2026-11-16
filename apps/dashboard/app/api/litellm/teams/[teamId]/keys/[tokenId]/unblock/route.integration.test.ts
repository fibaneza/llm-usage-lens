import { describe, expect, it, vi } from "vitest";

import {
  TOKEN_A,
  auditWith,
  bodyOf,
  defineKeyTokenContract,
  defineTeamScopedWriteContract,
  send,
  setupTeamWritesSuite,
  signInAs,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/support/litellm-team-writes-support";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupTeamWritesSuite();

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (blockKey / unblockKey:
// POST /key/block and /key/unblock with key=<token hash>; Lead + Admin; toggle
// on; audit the token id), "Resolution" (team confirmation, LT5), "API routes".
//
// Contract: POST /api/litellm/teams/[teamId]/keys/[tokenId]/unblock, no body.
//   200 { data: { tokenId, blocked: false } }; LiteLLM body exactly
//   { key: tokenId }; audit litellm.key.unblock, target { type: "litellm-key",
//   id: tokenId }.
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).POST;
};
const url = (team: string, token = TOKEN_A) =>
  `/api/litellm/teams/${team}/keys/${token}/unblock`;

defineTeamScopedWriteContract(state, {
  method: "POST",
  pattern: "/api/litellm/teams/[teamId]/keys/[tokenId]/unblock",
  action: "litellm.key.unblock",
  auditPrefix: "litellm.key.",
  toggleOp: "unblockKey",
  okStatus: 200,
  load,
  path: (team) => url(team),
  params: (team) => ({ teamId: team, tokenId: TOKEN_A }),
  targetType: "litellm-key",
});
defineKeyTokenContract(state, {
  method: "POST",
  toggleOp: "unblockKey",
  load,
  pathFor: (team, token) => url(team, token),
});

describe("POST /api/litellm/teams/[teamId]/keys/[tokenId]/unblock", () => {
  it("calls /key/unblock with only the token hash and audits the token id (Writes)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await send(await load(), {
      method: "POST",
      path: url("team-a"),
      params: { teamId: "team-a", tokenId: TOKEN_A },
    });
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ tokenId: TOKEN_A, blocked: false });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/key/unblock");
    expect(bodyOf(writes[0])).toEqual({ key: TOKEN_A });
    const [record] = await auditWith("litellm.key.");
    expect(record).toMatchObject({
      action: "litellm.key.unblock",
      result: "success",
      target: { type: "litellm-key", id: TOKEN_A },
    });
  });
});
