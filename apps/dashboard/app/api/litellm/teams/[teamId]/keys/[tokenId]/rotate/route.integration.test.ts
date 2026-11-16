import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  LTEAM,
  MEMBER_A_LUSER,
  NEW_KEY_VALUE,
  NEW_TOKEN,
  TOKEN_A,
  auditWith,
  bodyOf,
  callsTo,
  defineKeyTokenContract,
  defineTeamScopedWriteContract,
  enterProd,
  expectError,
  expectNotLogged,
  expectValueNeverStored,
  installTeamWritesFake,
  send,
  setupTeamWritesSuite,
  signInAs,
  spyOnLogs,
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

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (rotateKey row, incl. the
// OSS carry-over of 2026-11-15: models copied exactly and re-checked against
// the team and /models, remaining expiry rounded down, blocked state carried by
// generate -> block new -> block old; Enterprise body exactly { grace_period }),
// "Edition" (oss in dev, enterprise in prod), "Privileged targets" (rotateKey),
// "Resolution", LT4, LT5, LT9, LT14, LT18.
//
// Contract: POST /api/litellm/teams/[teamId]/keys/[tokenId]/rotate, strict body
//   { gracePeriod?: duration string } (Enterprise only; ignored on OSS).
//   200 { data: { tokenId: <new token>, previousTokenId: <old token>,
//   key: <new value, shown once> } }, Cache-Control no-store.
//   Audit litellm.key.rotate, target { type: "litellm-key", id: <old token> },
//   before { tokenIds: [old] }, after { tokenIds: [new] }; never the value.
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).POST;
};
const url = (team: string, token = TOKEN_A) =>
  `/api/litellm/teams/${team}/keys/${token}/rotate`;

defineTeamScopedWriteContract(state, {
  method: "POST",
  pattern: "/api/litellm/teams/[teamId]/keys/[tokenId]/rotate",
  action: "litellm.key.rotate",
  auditPrefix: "litellm.key.",
  toggleOp: "rotateKey",
  okStatus: 200,
  load,
  path: (team) => url(team),
  params: (team) => ({ teamId: team, tokenId: TOKEN_A }),
  body: {},
  targetType: "litellm-key",
});
defineKeyTokenContract(state, {
  method: "POST",
  toggleOp: "rotateKey",
  load,
  pathFor: (team, token) => url(team, token),
  body: {},
});

describe("POST /api/litellm/teams/[teamId]/keys/[tokenId]/rotate", () => {
  const rotate = async (payload: unknown = {}, token = TOKEN_A) =>
    send(await load(), {
      method: "POST",
      path: url("team-a", token),
      params: { teamId: "team-a", tokenId: token },
      body: payload,
    });
  const pathsOf = () => writeCalls(state).map((c) => c.path);

  it("OSS: generates a key carrying the old key's models and limits, then blocks the old one; the new value is shown once and never stored (rotateKey; LT9)", async () => {
    const spies = spyOnLogs();
    signInAs("teamAdminA");
    const { res, body, text } = await rotate();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data).toEqual({
      tokenId: NEW_TOKEN,
      previousTokenId: TOKEN_A,
      key: NEW_KEY_VALUE,
    });
    expect(text.split(NEW_KEY_VALUE)).toHaveLength(2);
    expect(pathsOf()).toEqual(["/key/generate", "/key/block"]);
    const [gen, block] = writeCalls(state);
    expect(bodyOf(gen)).toMatchObject({
      team_id: LTEAM["team-a"],
      user_id: MEMBER_A_LUSER,
      models: ["claude-sonnet"],
      max_budget: 10,
      rpm_limit: 5,
      metadata: {
        source: "llm-usage-lens",
        dashboardTeamId: "team-a",
        createdByOid: CALLERS.teamAdminA.oid,
      },
    });
    expect(bodyOf(gen)).not.toHaveProperty("duration");
    expect(bodyOf(gen)).not.toHaveProperty("blocked");
    expect(bodyOf(block)).toEqual({ key: TOKEN_A });
    const [record] = await auditWith("litellm.key.");
    expect(record).toMatchObject({
      action: "litellm.key.rotate",
      result: "success",
      target: { type: "litellm-key", id: TOKEN_A },
      before: { tokenIds: [TOKEN_A] },
      after: { tokenIds: [NEW_TOKEN] },
    });
    await expectValueNeverStored(NEW_KEY_VALUE, state);
    expectNotLogged(spies, NEW_KEY_VALUE);
  });

  it("OSS: the new key's duration is the old key's remaining life rounded down to the unit (10.5 days left is 10d)", async () => {
    installTeamWritesFake(state, {
      keys: { [TOKEN_A]: { expires: "2026-11-24T22:00:00.000Z" } },
    });
    signInAs("admin");
    await rotate();
    expect(bodyOf(writeCalls(state)[0])).toMatchObject({ duration: "10d" });
  });

  it("OSS: a blocked old key is rotated as generate, block the new key, block the old key; generate never carries `blocked` (LT4)", async () => {
    installTeamWritesFake(state, { keys: { [TOKEN_A]: { blocked: true } } });
    signInAs("admin");
    const { res } = await rotate();
    expect(res.status).toBe(200);
    const writes = writeCalls(state);
    expect(writes.map((c) => c.path)).toEqual([
      "/key/generate",
      "/key/block",
      "/key/block",
    ]);
    expect(bodyOf(writes[0])).not.toHaveProperty("blocked");
    expect(bodyOf(writes[1])).toEqual({ key: NEW_TOKEN });
    expect(bodyOf(writes[2])).toEqual({ key: TOKEN_A });
  });

  it("OSS: models the team or the proxy no longer offers refuse the rotation with 409 CONFLICT and no write (LT14)", async () => {
    installTeamWritesFake(state, {
      keys: { [TOKEN_A]: { models: ["claude-retired"] } },
    });
    signInAs("admin");
    await expectError((await rotate()).res, 409, "CONFLICT");
    expect(writeCalls(state)).toHaveLength(0);
  });

  it("OSS: an old model name that fails to parse is contract drift, 503 with no write (LT4, LT14)", async () => {
    installTeamWritesFake(state, {
      keys: { [TOKEN_A]: { models: ["bad model!"] } },
    });
    signInAs("admin");
    await expectError((await rotate()).res, 503, "LITELLM_UNAVAILABLE");
    expect(writeCalls(state)).toHaveLength(0);
  });

  it.each(["proxy_admin", "proxy_admin_viewer"])(
    "a key owned by a %s user is 409 PRIVILEGED_TARGET with no write, recorded as denied (LT18)",
    async (role) => {
      installTeamWritesFake(state, { roles: { [MEMBER_A_LUSER]: role } });
      signInAs("teamAdminA");
      await expectError((await rotate()).res, 409, "PRIVILEGED_TARGET");
      expect(writeCalls(state)).toHaveLength(0);
      const records = await auditWith("litellm.key.");
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "litellm.key.rotate",
        result: "denied",
        code: "PRIVILEGED_TARGET",
      });
    },
  );

  it("an unknown body field is 400 BAD_REQUEST with no write (LT4)", async () => {
    signInAs("admin");
    await expectError(
      (await rotate({ new_key: "sk-chosen" })).res,
      400,
      "BAD_REQUEST",
    );
    expect(writeCalls(state)).toHaveLength(0);
  });

  describe("Enterprise (prod)", () => {
    it("regenerates in place with a body of exactly { grace_period } and composes nothing else (Writes: rotateKey)", async () => {
      await enterProd({ approved: true });
      signInAs("admin");
      const { res, body } = await rotate({ gracePeriod: "1h" });
      expect(res.status).toBe(200);
      expect(body.data.key).toBe(NEW_KEY_VALUE);
      const writes = writeCalls(state);
      expect(writes).toHaveLength(1);
      expect(writes[0]?.path).toBe(`/key/${TOKEN_A}/regenerate`);
      expect(bodyOf(writes[0])).toEqual({ grace_period: "1h" });
      expect(callsTo(state, "POST /key/generate")).toHaveLength(0);
      expect(callsTo(state, "POST /key/block")).toHaveLength(0);
    });

    it("without a grace period the body is empty, never carrying ids, new_key or allowed_routes (LT4)", async () => {
      await enterProd({ approved: true });
      signInAs("admin");
      await rotate({});
      expect(bodyOf(writeCalls(state)[0])).toEqual({});
    });
  });
});
