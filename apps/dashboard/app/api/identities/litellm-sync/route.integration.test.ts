import { DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import {
  getIdentityLink,
  getLiteLLMUserOwner,
} from "@/lib/data/access/identity-links";
import { getAffiliation } from "@/lib/data/access/affiliations";
import {
  BASE_URL,
  HOST,
  expectError,
  expectNoSentinels,
  setToggles,
  setupViewsSuite,
  stubLiteLLMEnv,
} from "@/test/fakes/fake-litellm-views";
import type { RouteHandler } from "@/test/fakes/fake-litellm-views";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import {
  ENTRA_ISSUER,
  seedSignedIn,
} from "@/test/support/invite-accept-support";
import { stubSyncEnv } from "@/test/support/user-sync-support";
import { PEOPLE } from "@/test/support/matrix-route-support";
import {
  heldLease,
  installSyncFake,
  LTEAM,
  writeCalls,
} from "@/test/support/litellm-user-sync-support";
import type { SyncUser } from "@/test/support/litellm-user-sync-support";
import { TEST_TABLE_NAME, putRaw, testDoc } from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user sync"
// (Preview and apply: `409 PLAN_CHANGED`, `409 PLAN_TRUNCATED`, `409
// SYNC_RUNNING`, 80 pages, 500 changes and `remaining`, the lease; Records:
// `runId` on every record, the `litellm.user.sync` summary with `trigger` and
// `planHash`; Same person; Teams), its Tests table T-SY1, T-SY4, T-SY5, T-SY7,
// T-SY9, T-SY10, T-SY11, "API routes (additions)" (`/api/identities/litellm-sync`),
// "Permission matrix"; LiteLLM spec - LD37 (not configured: `200`,
// `configured: false`, no LiteLLM call), the toggle `syncLiteLLMUsers`
// (`OPERATION_DISABLED` when off), error codes. The 401, 403-before-parse for
// the auditor, user and no-role callers, 400 shape and no-store cases are the
// shared route-contract suite's (registry entries in test/route-registry.ts,
// Rule 60.23); this file adds the lead and route-specific cases. LiteLLM is the
// in-process fake (Rule 60.24).
//
// Assumed response shape (the developers build to it): GET `data` is
// `{ configured, planHash, truncated, counts, users: { litellmUserId, outcome,
// reason? }[], memberships, drift }`; POST `data` carries `remaining`.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const PATH = "/api/identities/litellm-sync";
const AUDIT_DAY = "2026-11-14";
const state = setupViewsSuite();
const alice = PEOPLE.alice;

const ALICE_LU: SyncUser = { id: "lu-alice", email: "Alice@Company.com" };
const BOB_LU: SyncUser = { id: "lu-bob", email: "bob@company.com" };
const ROOT_LU: SyncUser = {
  id: "lu-root",
  email: "root@company.com",
  role: "proxy_admin",
};
const SSO_VALUE = "SSOVALUE-SENTINEL-0001";
const DANA_LU: SyncUser = {
  id: "lu-dana",
  email: "dana@elsewhere.example",
  sso: SSO_VALUE,
};

async function load() {
  // SM3: an Entra identity's email key is its tenant-checked non-guest UPN.
  stubSyncEnv(ENTRA_ISSUER);
  stubLiteLLMEnv();
  return import("./route");
}
async function get(who: CallerName) {
  signInAs(who);
  const handler = (await load()).GET as RouteHandler;
  const res = await handler(
    new Request(`${BASE_URL}${PATH}`, { headers: { host: HOST } }),
    { params: Promise.resolve({}) },
  );
  const text = await res.clone().text();
  return { res, text, body: JSON.parse(text) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function post(who: CallerName, body: unknown) {
  signInAs(who);
  const handler = (await load()).POST as RouteHandler;
  const res = await handler(
    new Request(`${BASE_URL}${PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: HOST,
        origin: BASE_URL,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
  const text = await res.clone().text();
  return { res, text, body: JSON.parse(text) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function records(prefix: string) {
  const { listAuditRecords } = await import("@/lib/data/access/audit");
  return (await listAuditRecords(AUDIT_DAY)).filter((r) =>
    r.action.startsWith(prefix),
  );
}
const pendingOf = async (key: string) =>
  (
    await testDoc().send(
      new GetCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: `PENDING#${key}`, SK: "LITELLMLINK" },
      }),
    )
  ).Item;
const runIdOf = (record: unknown): string | undefined =>
  /"runId":"([^"]+)"/.exec(JSON.stringify(record))?.[1];

type Row = { litellmUserId: string; outcome: string; reason?: string };
const rowFor = (plan: { users: Row[] }, id: string) =>
  plan.users.find((u) => u.litellmUserId === id);

async function seedPeople() {
  await seedSignedIn(alice.oid, {
    upn: alice.email,
    email: alice.email,
    displayName: alice.name,
  });
}

describe("GET /api/identities/litellm-sync (the preview)", () => {
  it.each(["admin", "orgAdmin"] as CallerName[])(
    "%s reads the plan: outcomes, a plan hash, no sso_user_id, nothing written, LiteLLM read only (T-SY1, T-SY11, T-SY9)",
    async (who) => {
      await seedPeople();
      installSyncFake(state, { users: [ALICE_LU, BOB_LU, ROOT_LU, DANA_LU] });
      const { res, text, body } = await get(who);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(body.data.configured).toBe(true);
      expect(body.data.truncated).toBe(false);
      expect(typeof body.data.planHash).toBe("string");
      expect(body.data.planHash.length).toBeGreaterThanOrEqual(16);
      expect(rowFor(body.data, "lu-alice")).toMatchObject({
        outcome: "link-existing",
      });
      expect(rowFor(body.data, "lu-bob")).toMatchObject({
        outcome: "create-pending",
      });
      expect(rowFor(body.data, "lu-root")).toMatchObject({
        outcome: "skip",
        reason: "privileged",
      });
      expect(text.toLowerCase()).not.toContain(SSO_VALUE.toLowerCase());
      expectNoSentinels(text);
      expect(writeCalls(state)).toEqual([]);
      expect(await getIdentityLink(alice.oid)).toBeNull();
      expect(await pendingOf("bob@company.com")).toBeUndefined();
      expect(await records("litellm.user.sync")).toHaveLength(0);
    },
  );

  it("the plan hash is the same for the same state and differs once a person is added (T-SY5)", async () => {
    installSyncFake(state, { users: [BOB_LU] });
    const first = (await get("admin")).body.data.planHash;
    expect((await get("admin")).body.data.planHash).toBe(first);
    installSyncFake(state, { users: [BOB_LU, ALICE_LU] });
    expect((await get("admin")).body.data.planHash).not.toBe(first);
  });

  it.each(["teamAdminA", "deptAdminEng", "memberA"] as CallerName[])(
    "%s (lead or user) gets 403 and LiteLLM is not called (T-SY9)",
    async (who) => {
      installSyncFake(state, { users: [BOB_LU] });
      const { res } = await get(who);
      await expectError(res, 403, "FORBIDDEN");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("LiteLLM not configured: 200, configured false, no LiteLLM call (LiteLLM spec LD37, T-SY9)", async () => {
    await testDoc().send(
      new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
      }),
    );
    installSyncFake(state, { users: [BOB_LU] });
    const { res, body } = await get("admin");
    expect(res.status).toBe(200);
    expect(body.data.configured).toBe(false);
    expect(state.fake.calls).toHaveLength(0);
  });

  it("the operation switched off: 403 OPERATION_DISABLED, no LiteLLM call; a lead still gets FORBIDDEN first (LiteLLM spec - syncLiteLLMUsers)", async () => {
    await setToggles({ syncLiteLLMUsers: false });
    installSyncFake(state, { users: [BOB_LU] });
    await expectError((await get("admin")).res, 403, "OPERATION_DISABLED");
    await expectError((await get("teamAdminA")).res, 403, "FORBIDDEN");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("an unavailable LiteLLM is an error and writes nothing (T-SY7)", async () => {
    installSyncFake(state, { users: [BOB_LU], outage: true });
    const { res } = await get("admin");
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect((await records("litellm.user.sync")).length).toBe(0);
  });
});

describe("POST /api/identities/litellm-sync (apply)", () => {
  async function previewHash(who: CallerName = "admin") {
    return (await get(who)).body.data.planHash as string;
  }

  it("a lead, a user: 403 before parsing, one denied litellm.user.sync record, LiteLLM not called (T-SY9, Rule 10.3)", async () => {
    installSyncFake(state, { users: [BOB_LU] });
    for (const who of ["teamAdminA", "memberA"] as CallerName[]) {
      const { res } = await post(who, { nonsense: true });
      await expectError(res, 403, "FORBIDDEN");
    }
    expect(state.fake.calls).toHaveLength(0);
    const denied = (await records("litellm.user.sync")).filter(
      (r) => r.result === "denied",
    );
    expect(denied).toHaveLength(2);
    expect(denied[0]).toMatchObject({
      route: { method: "POST", pattern: PATH },
      code: "FORBIDDEN",
    });
  });

  it("applies the previewed plan: link, pending link, one audit record per change and one summary with the same runId (T-SY1, T-SY10, T-SY11)", async () => {
    await seedPeople();
    installSyncFake(state, { users: [ALICE_LU, BOB_LU, ROOT_LU] });
    const planHash = await previewHash();
    const { res, text, body } = await post("admin", { planHash });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data.remaining).toBe(0);
    expectNoSentinels(text);

    expect(await getIdentityLink(alice.oid)).toMatchObject({
      litellmUserId: "lu-alice",
    });
    expect(await getLiteLLMUserOwner("lu-alice")).toBe(alice.oid);
    expect(await pendingOf("bob@company.com")).toMatchObject({
      litellmUserId: "lu-bob",
    });
    expect(await pendingOf("root@company.com")).toBeUndefined();
    expect(await getLiteLLMUserOwner("lu-root")).toBeNull();

    const link = await records("identity.litellm-link.set");
    const pending = await records("identity.litellm-pending.set");
    const summary = await records("litellm.user.sync");
    expect(link).toHaveLength(1);
    expect(pending).toHaveLength(1);
    expect(summary).toHaveLength(1);
    expect(link[0]).toMatchObject({
      actor: CALLERS.admin.oid,
      after: { mode: "sync" },
    });
    expect(JSON.stringify(summary[0])).toContain("manual");
    expect(JSON.stringify(summary[0])).toContain(planHash);
    const runId = runIdOf(summary[0]);
    expect(runId).toBeTruthy();
    expect(runIdOf(link[0])).toBe(runId);
    expect(runIdOf(pending[0])).toBe(runId);
    expect(writeCalls(state)).toEqual([]);
  });

  it("a stale plan hash: 409 PLAN_CHANGED and nothing is written (T-SY5)", async () => {
    installSyncFake(state, { users: [BOB_LU] });
    const planHash = await previewHash();
    installSyncFake(state, { users: [BOB_LU, ALICE_LU] });
    const { res } = await post("admin", { planHash });
    await expectError(res, 409, "PLAN_CHANGED");
    expect(await pendingOf("bob@company.com")).toBeUndefined();
    expect(await pendingOf("alice@company.com")).toBeUndefined();
    expect(await records("litellm.user.sync")).toHaveLength(0);
  });

  it("the lease held by another run: 409 SYNC_RUNNING, nothing written, the lease untouched (T-SY5)", async () => {
    installSyncFake(state, { users: [BOB_LU] });
    const planHash = await previewHash();
    await putRaw(heldLease("2026-11-14T10:04:00.000Z"));
    const { res } = await post("admin", { planHash });
    await expectError(res, 409, "SYNC_RUNNING");
    expect(await pendingOf("bob@company.com")).toBeUndefined();
    const lease = await testDoc().send(
      new GetCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#USERSYNC", SK: "LOCK" },
      }),
    );
    expect(lease.Item).toMatchObject({ owner: "other-run" });
  });

  it("two applies at once: one wins, the other is refused, each change is written once (T-SY5)", async () => {
    await seedPeople();
    installSyncFake(state, { users: [ALICE_LU, BOB_LU] });
    const planHash = await previewHash();
    const [a, b] = await Promise.all([
      post("admin", { planHash }),
      post("orgAdmin", { planHash }),
    ]);
    const statuses = [a.res.status, b.res.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.res.status === 409 ? a : b;
    expect(["SYNC_RUNNING", "PLAN_CHANGED"]).toContain(loser.body.error.code);
    expect(await records("identity.litellm-link.set")).toHaveLength(1);
    expect(await records("identity.litellm-pending.set")).toHaveLength(1);
    expect(await records("litellm.user.sync")).toHaveLength(1);
  });

  it("a truncated plan: the preview says so, page 81 is not read, the POST is 409 PLAN_TRUNCATED and writes nothing (T-SY7)", async () => {
    // 80 pages of 25 users hold 2,000; the extra 100 are on page 81 and later.
    installSyncFake(state, { users: [BOB_LU], generated: 2100 });
    const preview = await get("admin");
    expect(preview.body.data.truncated).toBe(true);
    const pages = state.fake.calls
      .filter((c) => c.path === "/user/list")
      .map((c) => Number(new URL(c.url).searchParams.get("page") ?? 1));
    expect(Math.max(...pages)).toBe(80);

    const { res } = await post("admin", {
      planHash: preview.body.data.planHash,
    });
    await expectError(res, 409, "PLAN_TRUNCATED");
    expect(await pendingOf("bob@company.com")).toBeUndefined();
    expect(await records("litellm.user.sync")).toHaveLength(0);
  });

  it(
    "more than 500 changes: 500 are applied and `remaining` says how many are left; a new preview shows them (LiteLLM spec - bounds on demand)",
    { timeout: 120_000 },
    async () => {
      const users = Array.from({ length: 501 }, (_v, i) => ({
        id: `lu-bulk-${i}`,
        email: `bulk${i}@company.com`,
      }));
      installSyncFake(state, { users });
      const planHash = await previewHash();
      const { res, body } = await post("admin", { planHash });
      expect(res.status).toBe(200);
      expect(body.data.remaining).toBe(1);
      expect(await records("identity.litellm-pending.set")).toHaveLength(500);

      const next = await get("admin");
      const open = (next.body.data.users as Row[]).filter(
        (u) => u.outcome === "create-pending",
      );
      expect(open).toHaveLength(1);
      expect(next.body.data.planHash).not.toBe(planHash);
    },
  );

  it("the caller's own identity is skipped for the link and the membership: own-identity (T-SY4)", async () => {
    const me = CALLERS.orgAdmin;
    await seedSignedIn(me.oid, {
      upn: me.email,
      email: me.email,
      displayName: "Olive",
    });
    const mine: SyncUser = { id: "lu-me", email: me.email.toUpperCase() };
    installSyncFake(state, {
      users: [mine, BOB_LU],
      teamMembers: { [LTEAM["team-m"]]: [{ id: "lu-me" }, { id: "lu-bob" }] },
    });

    const asOther = await get("admin");
    expect(rowFor(asOther.body.data, "lu-me")).toMatchObject({
      outcome: "link-existing",
    });

    const preview = await get("orgAdmin");
    expect(rowFor(preview.body.data, "lu-me")).toMatchObject({
      outcome: "skip",
      reason: "own-identity",
    });
    const { res } = await post("orgAdmin", {
      planHash: preview.body.data.planHash,
    });
    expect(res.status).toBe(200);
    expect(await getIdentityLink(me.oid)).toBeNull();
    expect(await getLiteLLMUserOwner("lu-me")).toBeNull();
    expect(await getAffiliation(me.oid)).toBeNull();
  });

  it("a body that is not { planHash } is 400 for an allowed caller, and a toggle that is off is 403 OPERATION_DISABLED (Rule 10.3)", async () => {
    installSyncFake(state, { users: [BOB_LU] });
    await expectError(
      (await post("admin", { planHash: "abc", extra: 1 })).res,
      400,
      "BAD_REQUEST",
    );
    await setToggles({ syncLiteLLMUsers: false });
    await expectError(
      (await post("admin", { planHash: "abc" })).res,
      403,
      "OPERATION_DISABLED",
    );
    expect(await pendingOf("bob@company.com")).toBeUndefined();
  });

  it("LiteLLM not configured: the POST is the gateway's not-configured error and writes nothing (LD37)", async () => {
    await testDoc().send(
      new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
      }),
    );
    installSyncFake(state, { users: [BOB_LU] });
    const { res } = await post("admin", { planHash: "abc" });
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(state.fake.calls).toHaveLength(0);
    expect(await records("litellm.user.sync")).toHaveLength(0);
  });
});
