import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  LTEAM,
  MEMBER_A_LUSER,
  bodyOf,
  callsTo,
  defineMemberWriteContract,
  memberAudit,
  removeDashboardMembership,
  send,
  setupMemberWritesSuite,
  signInAs,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/support/litellm-member-writes-support";
import { useEnv } from "@/test/fakes/fake-litellm-views";

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

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (removeTeamMember:
// POST /team/member_delete, body team_id + user_id, Lead + Admin, toggle on per
// LD10 amended 2026-11-14, audit target litellmUserId), "Identity mapping and
// members" (removing a dashboard membership never changes LiteLLM; the
// separate "also remove from LiteLLM" action), "API routes" (DELETE
// .../members/[oid]), LT5.
//
// Contract: DELETE /api/litellm/teams/[teamId]/members/[oid], no body parsed.
//   200 { data: { oid, litellmUserId } }; one POST /team/member_delete
//   { team_id, user_id } and nothing else; audit litellm.member.remove, target
//   { type: "litellm-user", id: litellmUserId }, teamId.
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).DELETE;
};
const PATTERN = "/api/litellm/teams/[teamId]/members/[oid]";
const url = (team: string, oid: string) =>
  `/api/litellm/teams/${team}/members/${oid}`;

defineMemberWriteContract(state, {
  method: "DELETE",
  pattern: PATTERN,
  action: "litellm.member.remove",
  toggleOp: "removeTeamMember",
  okStatus: 200,
  load,
  path: url,
});

describe("DELETE /api/litellm/teams/[teamId]/members/[oid]", () => {
  const remove = async (oid = CALLERS.memberA.oid) =>
    send(await load(), {
      method: "DELETE",
      path: url("team-a", oid),
      params: { teamId: "team-a", oid },
    });

  it("removes exactly one member from the linked LiteLLM team with the exact body and audits it (Writes)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await remove();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      oid: CALLERS.memberA.oid,
      litellmUserId: MEMBER_A_LUSER,
    });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(`${writes[0]?.method} ${writes[0]?.path}`).toBe(
      "POST /team/member_delete",
    );
    expect(bodyOf(writes[0])).toEqual({
      team_id: LTEAM["team-a"],
      user_id: MEMBER_A_LUSER,
    });
    const [record, ...rest] = await memberAudit();
    expect(rest).toHaveLength(0);
    expect(record).toMatchObject({
      action: "litellm.member.remove",
      result: "success",
      actor: CALLERS.teamAdminA.oid,
      teamId: "team-a",
      target: { type: "litellm-user", id: MEMBER_A_LUSER },
    });
  });

  // Source: LiteLLM spec - the LW1 paragraph after `createUser`
  // (`removeTeamMember` is unchanged), test T-LW3.
  it("SSO enabled: removes exactly one member with one POST /team/member_delete, as without SSO (T-LW3)", async () => {
    useEnv({
      AUTH_MICROSOFT_ENTRA_ID_ID: "00000000-0000-4000-8000-000000000001",
    });
    signInAs("teamAdminA");
    const { res } = await remove();
    expect(res.status).toBe(200);
    const writes = writeCalls(state);
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /team/member_delete",
    ]);
  });

  it("a person already removed from the dashboard team can still be removed from LiteLLM (Identity mapping and members: 'also remove from LiteLLM')", async () => {
    await removeDashboardMembership(CALLERS.memberA.oid, "team-a");
    signInAs("teamAdminA");
    const { res } = await remove();
    expect(res.status).toBe(200);
    expect(callsTo(state, "POST /team/member_delete")).toHaveLength(1);
  });
});
