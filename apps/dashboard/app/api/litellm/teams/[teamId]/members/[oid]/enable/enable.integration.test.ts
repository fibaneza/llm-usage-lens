import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  MEMBER_A_LUSER,
  bodyOf,
  defineMemberWriteContract,
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

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (disableMember /
// enableMember: POST /key/block / POST /key/unblock once per key the member
// owns in that team, body key only; Lead + Admin; toggle on; audit
// litellmUserId and token ids), "Identity mapping and members" and LD2
// (blocks or unblocks every key the member owns in that team; never deletes
// keys or data; not proxy-wide), LT5, LT9.
//
// Contract: POST .../members/[oid]/enable, no body. 200
//   { data: { oid, litellmUserId, tokenIds: string[] } } (the keys acted on);
//   one POST /key/unblock { key: <token hash> } per key owned by the member in
//   the linked team (keys of other members or other teams are left alone);
//   audit litellm.member.enable, after { tokenIds } (no key values).
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).POST;
};
const PATTERN = "/api/litellm/teams/[teamId]/members/[oid]/enable";
const url = (team: string, oid: string) =>
  `/api/litellm/teams/${team}/members/${oid}/enable`;
const TOKEN_A = "a".repeat(64);

defineMemberWriteContract(state, {
  method: "POST",
  pattern: PATTERN,
  action: "litellm.member.enable",
  toggleOp: "enableMember",
  okStatus: 200,
  load,
  path: url,
});

describe("POST /api/litellm/teams/[teamId]/members/[oid]/enable", () => {
  it("unblocks every key the member owns in that team and no other key, never deleting (LD2)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await send(await load(), {
      method: "POST",
      path: url("team-a", CALLERS.memberA.oid),
      params: { teamId: "team-a", oid: CALLERS.memberA.oid },
    });
    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      oid: CALLERS.memberA.oid,
      litellmUserId: MEMBER_A_LUSER,
      tokenIds: [TOKEN_A],
    });
    const writes = writeCalls(state);
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /key/unblock",
    ]);
    expect(bodyOf(writes[0])).toEqual({ key: TOKEN_A });
    expect(JSON.stringify(state.fake.calls.map((c) => c.path))).not.toMatch(
      /delete|user\/update/,
    );
  });

  it("audits the token ids and never a key value (Writes; LT9)", async () => {
    signInAs("admin");
    await send(await load(), {
      method: "POST",
      path: url("team-a", CALLERS.memberA.oid),
      params: { teamId: "team-a", oid: CALLERS.memberA.oid },
    });
    const records = await memberAudit();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "litellm.member.enable",
      result: "success",
      target: { type: "litellm-user", id: MEMBER_A_LUSER },
      after: { tokenIds: [TOKEN_A] },
    });
    expect(JSON.stringify(records)).not.toContain("sk-KEY-VALUE-SENTINEL");
  });
});
