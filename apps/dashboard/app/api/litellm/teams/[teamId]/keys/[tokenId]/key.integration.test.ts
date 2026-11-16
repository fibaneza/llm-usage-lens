import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  MEMBER_A_LUSER,
  TOKEN_A,
  TOKEN_B,
  auditWith,
  bodyOf,
  callsTo,
  defineKeyTokenContract,
  defineTeamScopedWriteContract,
  expectError,
  installTeamWritesFake,
  send,
  setToggles,
  setupTeamWritesSuite,
  signInAs,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/litellm-team-writes-support";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupTeamWritesSuite();

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (updateMemberKey: POST
// /key/update with key=<token hash>, models, max_budget, budget_duration,
// rpm_limit, tpm_limit, max_parallel_requests, key_alias; Lead + Admin; audit
// token id before/after. deleteKey: POST /key/delete with keys:[<one token
// hash>]; Lead + Admin; toggle OFF by default, LD10), "Resolution" (a token is
// accepted only after /key/info confirms its team_id), "Privileged targets"
// (updateMemberKey refuses a proxy_admin owner), "Budgets and limits", LT4,
// LT5, LT10, LT14, LT18.
//
// Contract: PATCH /api/litellm/teams/[teamId]/keys/[tokenId], strict body
//   { keyAlias?, models?, maxBudget?, budgetDuration?, rpmLimit?, tpmLimit?,
//     maxParallelRequests? }, at least one; limits positive integers; models
//   non-empty and a subset of the team's models; limits <= the owner's
//   membership and the team's. Only fields given are sent.
//   200 { data: { tokenId, ...given fields } }; audit litellm.key.update,
//   target { type: "litellm-key", id: tokenId }, before/after of the changed
//   fields only (keyAlias, models, maxBudget, budgetDuration, rpmLimit,
//   tpmLimit, maxParallelRequests) read from /key/info.
// Contract: DELETE /api/litellm/teams/[teamId]/keys/[tokenId], no body.
//   200 { data: { tokenId, deleted: true } }; audit litellm.key.delete,
//   target the token id; LiteLLM body exactly { keys: [tokenId] }.
const loadPatch = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).PATCH;
};
const loadDelete = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).DELETE;
};
const PATTERN = "/api/litellm/teams/[teamId]/keys/[tokenId]";
const url = (team: string, token = TOKEN_A) =>
  `/api/litellm/teams/${team}/keys/${token}`;

defineTeamScopedWriteContract(state, {
  method: "PATCH",
  pattern: PATTERN,
  action: "litellm.key.update",
  auditPrefix: "litellm.key.",
  toggleOp: "updateMemberKey",
  okStatus: 200,
  load: loadPatch,
  path: (team) => url(team),
  params: (team) => ({ teamId: team, tokenId: TOKEN_A }),
  body: { rpmLimit: 3 },
  targetType: "litellm-key",
});
defineKeyTokenContract(state, {
  method: "PATCH",
  toggleOp: "updateMemberKey",
  load: loadPatch,
  pathFor: (team, token) => url(team, token),
  body: { rpmLimit: 3 },
});

defineTeamScopedWriteContract(state, {
  method: "DELETE",
  pattern: PATTERN,
  action: "litellm.key.delete",
  auditPrefix: "litellm.key.",
  toggleOp: "deleteKey",
  defaultOff: true,
  okStatus: 200,
  load: loadDelete,
  path: (team) => url(team),
  params: (team) => ({ teamId: team, tokenId: TOKEN_A }),
  targetType: "litellm-key",
});
defineKeyTokenContract(state, {
  method: "DELETE",
  toggleOp: "deleteKey",
  defaultOff: true,
  load: loadDelete,
  pathFor: (team, token) => url(team, token),
});

describe("PATCH /api/litellm/teams/[teamId]/keys/[tokenId]", () => {
  const patch = async (payload: unknown, token = TOKEN_A) =>
    send(await loadPatch(), {
      method: "PATCH",
      path: url("team-a", token),
      params: { teamId: "team-a", tokenId: token },
      body: payload,
    });

  it("sends only the token and the fields given, and audits before/after from /key/info (Writes; LT10)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await patch({ rpmLimit: 3 });
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ tokenId: TOKEN_A, rpmLimit: 3 });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/key/update");
    expect(bodyOf(writes[0])).toEqual({ key: TOKEN_A, rpm_limit: 3 });
    const [record] = await auditWith("litellm.key.");
    expect(record).toMatchObject({
      action: "litellm.key.update",
      result: "success",
      target: { type: "litellm-key", id: TOKEN_A },
      before: { rpmLimit: 5 },
      after: { rpmLimit: 3 },
    });
  });

  it("renames the alias and narrows models inside the team's models (Writes: key_alias, models)", async () => {
    signInAs("admin");
    const { res } = await patch({
      keyAlias: "renamed",
      models: ["claude-sonnet"],
    });
    expect(res.status).toBe(200);
    expect(bodyOf(writeCalls(state)[0])).toEqual({
      key: TOKEN_A,
      key_alias: "renamed",
      models: ["claude-sonnet"],
    });
    const [record] = await auditWith("litellm.key.");
    expect(record).toMatchObject({
      before: { keyAlias: "alias-a", models: ["claude-sonnet"] },
      after: { keyAlias: "renamed", models: ["claude-sonnet"] },
    });
  });

  it("a key of another person in the same team can be updated (the team is the boundary, LT5)", async () => {
    signInAs("admin");
    expect((await patch({ rpmLimit: 2 }, TOKEN_B)).res.status).toBe(200);
  });

  it("parallel requests above the team's max_parallel_requests of 4 are 400 for a member with no limits of their own, no write (B4)", async () => {
    installTeamWritesFake(state, { noMemberLimits: true });
    signInAs("admin");
    await expectError(
      (await patch({ maxParallelRequests: 5 })).res,
      400,
      "BAD_REQUEST",
    );
    expect(callsTo(state, "POST /key/update")).toHaveLength(0);
    expect((await patch({ maxParallelRequests: 4 })).res.status).toBe(200);
  });

  it("a key with no user_id is 404 NOT_FOUND with no write: the privileged-owner check fails closed, as rotate does (W1; LT18)", async () => {
    installTeamWritesFake(state, { keys: { [TOKEN_A]: { user_id: null } } });
    signInAs("admin");
    await expectError((await patch({ rpmLimit: 3 })).res, 404, "NOT_FOUND");
    expect(writeCalls(state)).toHaveLength(0);
  });

  it.each(["proxy_admin", "proxy_admin_viewer"])(
    "a key owned by a %s user is 409 PRIVILEGED_TARGET with no /key/update call, recorded as denied (LT18)",
    async (role) => {
      installTeamWritesFake(state, { roles: { [MEMBER_A_LUSER]: role } });
      signInAs("teamAdminA");
      const { res } = await patch({ rpmLimit: 3 });
      await expectError(res, 409, "PRIVILEGED_TARGET");
      expect(callsTo(state, "POST /key/update")).toHaveLength(0);
      const records = await auditWith("litellm.key.");
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "litellm.key.update",
        result: "denied",
        code: "PRIVILEGED_TARGET",
        actor: CALLERS.teamAdminA.oid,
      });
    },
  );

  it.each([
    ["a model the team does not have", { models: ["claude-haiku"] }],
    ["an empty model list", { models: [] }],
    ["an rpm above the owner's membership limit of 5", { rpmLimit: 6 }],
    ["a budget above the owner's membership budget of 10", { maxBudget: 11 }],
    [
      "parallel requests above the owner's membership limit of 3 (B4)",
      { maxParallelRequests: 4 },
    ],
    ["zero rpm", { rpmLimit: 0 }],
    ["a null limit", { tpmLimit: null }],
    ["a string limit", { rpmLimit: "5" }],
    ["an empty body (nothing to change)", {}],
    ["an unknown field (key)", { rpmLimit: 1, key: "sk-other" }],
    ["an unknown field (user_id)", { rpmLimit: 1, user_id: "x@y.com" }],
  ])(
    "%s is 400 BAD_REQUEST with no LiteLLM write (Budgets and limits; LT4, LT10, LT14)",
    async (_n, payload) => {
      signInAs("admin");
      await expectError((await patch(payload)).res, 400, "BAD_REQUEST");
      expect(writeCalls(state)).toHaveLength(0);
    },
  );
});

describe("DELETE /api/litellm/teams/[teamId]/keys/[tokenId]", () => {
  const del = async (token = TOKEN_A) =>
    send(await loadDelete(), {
      method: "DELETE",
      path: url("team-a", token),
      params: { teamId: "team-a", tokenId: token },
    });

  it("is off by default: 403 OPERATION_DISABLED with no LiteLLM call and nothing audited (LD10)", async () => {
    signInAs("admin");
    await expectError((await del()).res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
    expect(await auditWith("litellm.key.")).toHaveLength(0);
  });

  it("deletes exactly one key: the body is { keys: [token] } and the audit names the token (Writes)", async () => {
    await setToggles({ deleteKey: true });
    signInAs("teamAdminA");
    const { res, body } = await del(TOKEN_B);
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ tokenId: TOKEN_B, deleted: true });
    const writes = writeCalls(state);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/key/delete");
    expect(bodyOf(writes[0])).toEqual({ keys: [TOKEN_B] });
    const [record] = await auditWith("litellm.key.");
    expect(record).toMatchObject({
      action: "litellm.key.delete",
      result: "success",
      target: { type: "litellm-key", id: TOKEN_B },
    });
  });
});
