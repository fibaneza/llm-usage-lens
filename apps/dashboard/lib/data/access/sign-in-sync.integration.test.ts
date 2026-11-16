import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { isAdminScopeSuspended } from "@llm-usage-lens/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/support/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/test/support/access-test-support").then((m) => m.faultyDynamodb()),
);
const bind = vi.hoisted(() => vi.fn());
vi.mock("./sso-binding", () => ({ bindPasswordUserOnEntraSignIn: bind }));

import { upsertIdentity } from "@/lib/data/identity";
import type { SignedInIdentity } from "@/lib/auth/master-user";

import {
  CURSOR_SECRET,
  NOW,
  OID_A,
  OID_B,
  auditRecords,
  ctxAt,
  faults,
  ok,
  resetFaults,
} from "@/test/support/access-test-support";
import { listAdminScopes } from "./admin-scopes";
import { addMember, getAffiliation } from "./affiliations";
import { createGroupMapping } from "./group-mappings";
import { createPendingItem, listPendingFor } from "./pending";
import { applySignInResolution } from "./sign-in-sync";

// Source: docs/specs/2026-11-10-access-control.md — "Identity, SSO mapping and
// defaults" (resolution cases 1-6), "Membership" Joiner (bind on tid + the
// lower-cased UPN only; amended R2), "Audit log" (one record per change,
// actor `system`, same transaction; D18 auth.signin.success), "Sign-in
// methods"/D25 (Entra sign-in calls the password-user bind). Threats T2, T8,
// T18, T26. Contract R2 §1 decision 11 (one transaction, > 100 items throws),
// §3 `applySignInResolution`, §6 T2/T8; R2b parallel contract (bind interface).
const TID = "00000000-0000-4000-8000-0000000000aa";
const FOREIGN_TID = "00000000-0000-4000-8000-0000000000bb";
const REQ = "req-signin";
const UPN = "alice@corp.example";
const opts = { cursorSecret: CURSOR_SECRET };

const identityOf = (
  over: Partial<SignedInIdentity> = {},
): SignedInIdentity => ({
  oid: OID_A,
  tid: TID,
  upn: UPN,
  email: "alice.work@corp.example",
  displayName: "Alice",
  roles: ["internal-viewer"],
  authMethod: "entra",
  ...over,
});

async function signIn(
  over: {
    identity?: SignedInIdentity;
    groups?: string[];
    groupsOverage?: boolean;
    requestId?: string;
  } = {},
) {
  const identity = over.identity ?? identityOf();
  await upsertIdentity(identity, NOW);
  return applySignInResolution({
    identity,
    groups: over.groups ?? [],
    groupsOverage: over.groupsOverage ?? false,
    expectedTid: TID,
    requestId: over.requestId ?? REQ,
    now: NOW,
  });
}

async function syncRecords(requestId = REQ) {
  return (await auditRecords()).filter((r) => r.requestId === requestId);
}
const actionsOf = async (requestId = REQ) =>
  (await syncRecords(requestId)).map((r) => r.action).sort();

async function flagsOf(oid: string) {
  const res = await testDoc().send(
    new GetCommand({
      TableName: TEST_TABLE_NAME,
      Key: { PK: `IDENT#${oid}`, SK: "META" },
    }),
  );
  return {
    ambiguousMembership: res.Item?.ambiguousMembership === true,
    groupsOverage: res.Item?.groupsOverage === true,
    item: res.Item,
  };
}

const mapMember = (groupId: string, teamId: string) =>
  createGroupMapping(
    { groupId, target: { type: "team", id: teamId }, scopedRole: "member" },
    setupCtx,
  ).then(ok);
const mapAdmin = (groupId: string, type: "team" | "department", id: string) =>
  createGroupMapping(
    { groupId, target: { type, id }, scopedRole: "internal-team-admin" },
    setupCtx,
  ).then(ok);
const pendingMember = (emailOrUpn: string, teamId: string) =>
  createPendingItem({ kind: "affiliation", emailOrUpn, teamId }, setupCtx).then(
    ok,
  );

beforeAll(ensureTestTable);
let setupCtx = ctxAt(NOW, "req-setup");
beforeEach(async () => {
  setupCtx = ctxAt(NOW, "req-setup");
  await clearTable();
  resetFaults();
  bind.mockReset().mockResolvedValue({ bound: false });
});

describe("applySignInResolution: SSO mappings (T8)", () => {
  it("applies a member and an admin mapping, one system record per change, plus the sign-in record", async () => {
    await mapMember("g-m", "team-a");
    await mapAdmin("g-a", "team", "team-b");

    const plan = await signIn({ groups: ["g-m", "g-a"] });

    expect(plan.affiliation).toEqual({
      op: "put",
      teamId: "team-a",
      source: "sso",
    });
    expect(await getAffiliation(OID_A)).toMatchObject({
      teamId: "team-a",
      source: "sso",
    });
    const scopes = ok(await listAdminScopes(OID_A, opts)).items;
    expect(scopes).toEqual([
      expect.objectContaining({
        scopeType: "team",
        scopeId: "team-b",
        source: "sso",
      }),
    ]);
    expect(await actionsOf()).toEqual([
      "adminscope.sso.add",
      "affiliation.sso.set",
      "auth.signin.success",
    ]);
    const changes = (await syncRecords()).filter(
      (r) => r.action !== "auth.signin.success",
    );
    expect(
      changes.every((r) => r.actor === "system" && r.result === "success"),
    ).toBe(true);
  });

  it("records auth.signin.success once with the user as actor, the method and no claims (D18)", async () => {
    await signIn({ groups: ["g-unmapped"] });
    const success = (await syncRecords()).filter(
      (r) => r.action === "auth.signin.success",
    );
    expect(success).toHaveLength(1);
    expect(success[0]).toMatchObject({
      actor: OID_A,
      category: "change",
      result: "success",
      target: { type: "identity", id: OID_A },
      after: { method: "entra" },
    });
    expect(JSON.stringify(success[0])).not.toContain("g-unmapped");
    expect(JSON.stringify(success[0])).not.toContain(UPN);
  });

  it("unmapped groups change nothing: only the sign-in record is written", async () => {
    await mapMember("g-m", "team-a");
    await signIn({ groups: ["g-other"] });
    expect(await getAffiliation(OID_A)).toBeNull();
    expect(await actionsOf()).toEqual(["auth.signin.success"]);
    expect(await flagsOf(OID_A)).toMatchObject({
      ambiguousMembership: false,
      groupsOverage: false,
    });
  });

  it("a repeat sign-in with the same groups writes no change records", async () => {
    await mapMember("g-m", "team-a");
    await signIn({ groups: ["g-m"] });
    await signIn({ groups: ["g-m"], requestId: "req-second" });
    expect(await actionsOf("req-second")).toEqual(["auth.signin.success"]);
  });

  it("removing the group deletes the SSO affiliation and scope, one record each", async () => {
    await mapMember("g-m", "team-a");
    await mapAdmin("g-a", "team", "team-b");
    await signIn({ groups: ["g-m", "g-a"] });
    await signIn({ groups: [], requestId: "req-left" });
    expect(await getAffiliation(OID_A)).toBeNull();
    expect(ok(await listAdminScopes(OID_A, opts)).items).toEqual([]);
    expect(await actionsOf("req-left")).toEqual([
      "adminscope.sso.remove",
      "affiliation.sso.remove",
      "auth.signin.success",
    ]);
  });

  it("ambiguous member mappings apply none, keep the UI affiliation, still apply admin scopes, and set the flag", async () => {
    await mapMember("g-1", "team-a");
    await mapMember("g-2", "team-b");
    await mapAdmin("g-a", "team", "team-c");
    ok(await addMember({ oid: OID_A, teamId: "team-ui" }, setupCtx));

    await signIn({ groups: ["g-1", "g-2", "g-a"] });

    expect(await getAffiliation(OID_A)).toMatchObject({
      teamId: "team-ui",
      source: "ui",
    });
    expect(ok(await listAdminScopes(OID_A, opts)).items).toHaveLength(1);
    expect((await flagsOf(OID_A)).ambiguousMembership).toBe(true);
    expect(await actionsOf()).toContain("identity.flags.update");
  });

  it("ambiguous member mappings delete a previously SSO-sourced affiliation", async () => {
    await mapMember("g-1", "team-a");
    await signIn({ groups: ["g-1"] });
    await mapMember("g-2", "team-b");
    await signIn({ groups: ["g-1", "g-2"], requestId: "req-amb" });
    expect(await getAffiliation(OID_A)).toBeNull();
    expect((await flagsOf(OID_A)).ambiguousMembership).toBe(true);
    expect(await actionsOf("req-amb")).toContain("affiliation.sso.remove");
  });

  it("groups overage writes no scopes, deletes the SSO affiliation, flags the identity, and suspends SSO scopes; a full claim clears it", async () => {
    await mapMember("g-m", "team-a");
    await mapAdmin("g-a", "team", "team-b");
    await signIn({ groups: ["g-m", "g-a"] });

    await signIn({ groups: [], groupsOverage: true, requestId: "req-over" });
    expect(await getAffiliation(OID_A)).toBeNull();
    const flags = await flagsOf(OID_A);
    expect(flags.groupsOverage).toBe(true);
    const scope = ok(await listAdminScopes(OID_A, opts)).items[0];
    expect(scope).toBeDefined();
    if (scope)
      expect(isAdminScopeSuspended(scope, { groupsOverage: true })).toBe(true);

    await signIn({ groups: ["g-m", "g-a"], requestId: "req-full" });
    expect((await flagsOf(OID_A)).groupsOverage).toBe(false);
    expect(await getAffiliation(OID_A)).toMatchObject({
      teamId: "team-a",
      source: "sso",
    });
  });

  it("overage leaves a pending admin-scope invite pending (no adminscope.bind) while a pending member invite still binds", async () => {
    await createPendingItem(
      {
        kind: "adminScope",
        emailOrUpn: UPN,
        scopeType: "team",
        scopeId: "team-z",
      },
      setupCtx,
    );
    await pendingMember(UPN, "team-m");

    await signIn({ groups: [], groupsOverage: true, requestId: "req-ovp" });

    expect(ok(await listAdminScopes(OID_A, opts)).items).toEqual([]);
    expect(await actionsOf("req-ovp")).not.toContain("adminscope.bind");
    expect(await actionsOf("req-ovp")).toContain("affiliation.bind");
    expect(await getAffiliation(OID_A)).toMatchObject({ teamId: "team-m" });
    const pending = await listPendingFor([UPN]);
    expect(pending).toEqual([
      expect.objectContaining({ kind: "adminScope", scopeId: "team-z" }),
    ]);
  });

  it("overage on a first sign-in writes no scopes", async () => {
    await mapAdmin("g-a", "team", "team-b");
    await signIn({ groups: [], groupsOverage: true });
    expect(ok(await listAdminScopes(OID_A, opts)).items).toEqual([]);
  });
});

describe("applySignInResolution: shared audit sequence", () => {
  it("advances a supplied sequence by the number of records written, so a later record in the request does not collide", async () => {
    await mapMember("g-m", "team-a");
    const sequence = { next: 0 };
    const identity = identityOf();
    await upsertIdentity(identity, NOW);
    await applySignInResolution({
      identity,
      groups: ["g-m"],
      groupsOverage: false,
      expectedTid: TID,
      requestId: "req-seq",
      now: NOW,
      sequence,
    });
    expect(sequence.next).toBe((await syncRecords("req-seq")).length);
    expect(sequence.next).toBeGreaterThan(1);
  });
});

describe("applySignInResolution: one transaction (T8, T18)", () => {
  it("writes nothing and rejects when the transaction fails, so the sign-in fails", async () => {
    await mapMember("g-m", "team-a");
    faults.transact = true;
    await expect(signIn({ groups: ["g-m"] })).rejects.toThrow();
    faults.transact = false;
    expect(await getAffiliation(OID_A)).toBeNull();
    expect(await syncRecords()).toEqual([]);
  });

  it("rejects, writing nothing, when the plan needs more than 100 transaction items", async () => {
    const groups: string[] = [];
    for (let i = 0; i < 101; i += 1) {
      const groupId = `g-${String(i).padStart(3, "0")}`;
      groups.push(groupId);
      await mapAdmin(groupId, "team", `team-${String(i).padStart(3, "0")}`);
    }
    await expect(signIn({ groups })).rejects.toThrow();
    expect(ok(await listAdminScopes(OID_A, opts)).items).toEqual([]);
    expect(await syncRecords()).toEqual([]);
  });
});

describe("applySignInResolution: pending bind (T2)", () => {
  it("binds a pending affiliation on the UPN, case-insensitively, as a ui affiliation with an affiliation.bind record by system", async () => {
    await pendingMember("Alice@Corp.Example", "team-a");
    const plan = await signIn({
      identity: identityOf({ upn: "ALICE@corp.example" }),
    });
    expect(plan.pendingDeletes).toEqual([
      expect.objectContaining({ reason: "bound" }),
    ]);
    expect(await getAffiliation(OID_A)).toMatchObject({
      teamId: "team-a",
      source: "ui",
    });
    expect(await listPendingFor([UPN])).toEqual([]);
    const bound = (await syncRecords()).filter(
      (r) => r.action === "affiliation.bind",
    );
    expect(bound).toHaveLength(1);
    expect(bound[0]).toMatchObject({ actor: "system", result: "success" });
  });

  it("binds a pending admin scope on the UPN with an adminscope.bind record", async () => {
    await createPendingItem(
      {
        kind: "adminScope",
        emailOrUpn: UPN,
        scopeType: "team",
        scopeId: "team-z",
      },
      setupCtx,
    );
    await signIn();
    expect(ok(await listAdminScopes(OID_A, opts)).items).toEqual([
      expect.objectContaining({ scopeId: "team-z", source: "ui" }),
    ]);
    expect(await actionsOf()).toContain("adminscope.bind");
  });

  it("never binds on the email claim", async () => {
    await pendingMember("alice.work@corp.example", "team-a");
    await signIn();
    expect(await getAffiliation(OID_A)).toBeNull();
    expect(await listPendingFor(["alice.work@corp.example"])).toHaveLength(1);
  });

  it("never binds when the identity has no UPN, even if the email matches a pending key", async () => {
    await pendingMember("alice.work@corp.example", "team-a");
    await signIn({ identity: identityOf({ upn: undefined }) });
    expect(await getAffiliation(OID_A)).toBeNull();
    expect(await listPendingFor(["alice.work@corp.example"])).toHaveLength(1);
  });

  it("never binds a guest UPN (#EXT#)", async () => {
    const guest = "alice_partner.example#EXT#@corp.onmicrosoft.com";
    await pendingMember(guest, "team-a");
    await signIn({ identity: identityOf({ upn: guest }) });
    expect(await getAffiliation(OID_A)).toBeNull();
    expect(await listPendingFor([guest])).toHaveLength(1);
  });

  it("binds nothing for a foreign tenant", async () => {
    await pendingMember(UPN, "team-a");
    await signIn({ identity: identityOf({ tid: FOREIGN_TID }) });
    expect(await getAffiliation(OID_A)).toBeNull();
    expect(await listPendingFor([UPN])).toHaveLength(1);
  });

  it("after binding, a different oid with the same UPN gets nothing", async () => {
    await pendingMember(UPN, "team-a");
    await signIn();
    await signIn({
      identity: identityOf({ oid: OID_B }),
      requestId: "req-other",
    });
    expect(await getAffiliation(OID_B)).toBeNull();
    expect(await getAffiliation(OID_A)).toMatchObject({ teamId: "team-a" });
  });

  it("a single SSO member target discards the invite with a pending.discard record", async () => {
    await mapMember("g-m", "team-sso");
    await pendingMember(UPN, "team-invite");
    await signIn({ groups: ["g-m"] });
    expect(await getAffiliation(OID_A)).toMatchObject({
      teamId: "team-sso",
      source: "sso",
    });
    expect(await listPendingFor([UPN])).toEqual([]);
    expect(await actionsOf()).toContain("pending.discard");
    expect(await actionsOf()).not.toContain("affiliation.bind");
  });

  it("an existing UI affiliation discards the pending one", async () => {
    ok(await addMember({ oid: OID_A, teamId: "team-ui" }, setupCtx));
    await pendingMember(UPN, "team-invite");
    await signIn();
    expect(await getAffiliation(OID_A)).toMatchObject({ teamId: "team-ui" });
    expect(await listPendingFor([UPN])).toEqual([]);
  });
});

describe("applySignInResolution: password-user bind (D25, T26)", () => {
  it("calls bindPasswordUserOnEntraSignIn once with the oid, tid and UPN, and a system context for this request", async () => {
    await signIn();
    expect(bind).toHaveBeenCalledTimes(1);
    const [claims, ctx] = bind.mock.calls[0] ?? [];
    expect(claims).toEqual({ oid: OID_A, tid: TID, preferredUsername: UPN });
    expect(ctx).toMatchObject({ actor: "system", requestId: REQ, now: NOW });
    expect(ctx).toHaveProperty("sequence");
  });

  it("never passes the email claim as the preferred username", async () => {
    await signIn({ identity: identityOf({ upn: undefined }) });
    const [claims] = bind.mock.calls[0] ?? [];
    expect(
      (claims as { preferredUsername?: string }).preferredUsername,
    ).toBeUndefined();
    expect(JSON.stringify(claims)).not.toContain("alice.work@corp.example");
  });

  it("does not attempt a bind for a foreign tenant", async () => {
    await signIn({ identity: identityOf({ tid: FOREIGN_TID }) });
    expect(bind).not.toHaveBeenCalled();
  });

  it("still completes the sign-in when a bind moved items", async () => {
    bind.mockResolvedValue({ bound: true, fromIdentityId: "local:alice" });
    await expect(signIn()).resolves.toBeDefined();
    expect(await actionsOf()).toContain("auth.signin.success");
  });

  it("fails the sign-in, writing no sign-in record, when the bind throws (fail closed)", async () => {
    bind.mockRejectedValue(new Error("reservation conflict"));
    await expect(signIn()).rejects.toThrow();
    expect(await syncRecords()).toEqual([]);
  });
});
