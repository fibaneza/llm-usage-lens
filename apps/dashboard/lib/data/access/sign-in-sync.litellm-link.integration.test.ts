import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { SignedInIdentity } from "@/lib/auth/master-user";
import {
  ENTRA_ISSUER,
  FOREIGN_TENANT,
  TENANT,
} from "@/test/support/password-test-support";
import { OID_A, ctxAt, ok } from "@/test/support/access-test-support";
import {
  setupViewsSuite,
  stubLiteLLMEnv,
} from "@/test/fakes/fake-litellm-views";
import {
  installSyncFake,
  seedPendingLinksViaSync,
  writeCalls,
} from "@/test/support/litellm-user-sync-support";
import { TEST_TABLE_NAME, putRaw, testDoc } from "@/test/support/test-support";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
// The test stubs LITELLM_* through vi.stubEnv after this factory ran, so a
// string variable is read from process.env at access time; the rest (and the
// issuer) come from the validated env.
vi.mock("@/env", async (orig) => {
  const real = (await orig<typeof import("@/env")>()).env;
  const env = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "AUTH_MICROSOFT_ENTRA_ID_ISSUER") return ENTRA_ISSUER;
      if (typeof prop === "string" && process.env[prop] !== undefined) {
        return process.env[prop];
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { env };
});

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user sync"
// (*Pending LiteLLM links*: no LiteLLM call at sign-in, both placeholder keys,
// the Joiner rule's conditions, one transaction, never overwritten, a password
// sign-in links from `PENDING#{email}`, a sign-in never fails because of a
// pending link; *Match keys per sign-in mode*: order bind, invite, link), its
// Tests T-SY6, T-SM3, T-SM4; decisions SM2, SM4, SM5, S19.
// Assumed API (the developers build to it):
//   applySignInResolution(...) (existing, Entra) makes the link step last;
//   applyPasswordSignInLink({ identity: { oid, email }, requestId, now,
//     sequence? }): Promise<void> in `sign-in-sync.ts`, called by `auth.ts`
//     for a password sign-in.
// A pending link is written by the sync itself (`runLiteLLMUserSync`), so the
// claim's owner shape (the worker's decision) is never assumed here, except for
// the one case where the claim is held by someone else and the placeholder is
// written raw.
const TID = TENANT;
const REQ = "req-signin-link";
const UPN = "new.hire@corp.example";
const state = setupViewsSuite();

const identityOf = (
  over: Partial<SignedInIdentity> = {},
): SignedInIdentity => ({
  oid: OID_A,
  tid: TID,
  upn: UPN,
  email: "someone.else@corp.example",
  displayName: "New Hire",
  roles: ["internal-viewer"],
  authMethod: "entra",
  ...over,
});

async function mods() {
  stubLiteLLMEnv();
  const [{ upsertIdentity }, sync, links, audit] = await Promise.all([
    import("@/lib/data/identity"),
    import("./sign-in-sync"),
    import("./identity-links"),
    import("./audit"),
  ]);
  return { upsertIdentity, sync, links, audit };
}

async function signIn(
  over: { identity?: SignedInIdentity; requestId?: string } = {},
) {
  const { upsertIdentity, sync } = await mods();
  const identity = over.identity ?? identityOf();
  const now = new Date();
  await upsertIdentity(identity, now);
  return sync.applySignInResolution({
    identity,
    groups: [],
    groupsOverage: false,
    expectedTid: TID,
    requestId: over.requestId ?? REQ,
    now,
  });
}

// The placeholder key of an SSO reference: a hash, never the reference itself
// (Access Control - LiteLLM user sync, ~line 1033, S20: `PENDING#sso:<sha256
// hex of the lower-cased sso_user_id>`).
const ssoKey = (ref: string) =>
  `sso:${createHash("sha256").update(ref.toLowerCase()).digest("hex")}`;

const pendingOf = async (key: string) =>
  (
    await testDoc().send(
      new GetCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: `PENDING#${key.toLowerCase()}`, SK: "LITELLMLINK" },
      }),
    )
  ).Item;

async function recordsOf(requestId = REQ) {
  const { audit } = await mods();
  return (await audit.listAuditRecords("2026-11-14")).filter(
    (r) => r.requestId === requestId,
  );
}
const linkOf = async (oid: string) => (await mods()).links.getIdentityLink(oid);
const ownerOf = async (id: string) =>
  (await mods()).links.getLiteLLMUserOwner(id);

const HIRE: { id: string; email: string } = { id: "lu-hire", email: UPN };

describe("an Entra sign-in makes the LiteLLM link from a pending link (T-SY6, T-SM3)", () => {
  it("binds on the tenant and the lower-cased UPN: the link is written with mode sync, actor system, the claim moves to the oid, the placeholder goes, and LiteLLM is not called (S19)", async () => {
    await seedPendingLinksViaSync(state, [HIRE]);
    expect(await pendingOf(UPN)).toBeDefined();

    await signIn({ identity: identityOf({ upn: "New.Hire@Corp.Example" }) });

    expect(await linkOf(OID_A)).toMatchObject({ litellmUserId: "lu-hire" });
    expect(await ownerOf("lu-hire")).toBe(OID_A);
    expect(await pendingOf(UPN)).toBeUndefined();
    const set = (await recordsOf()).filter(
      (r) => r.action === "identity.litellm-link.set",
    );
    expect(set).toHaveLength(1);
    expect(set[0]).toMatchObject({
      actor: "system",
      after: { mode: "sync", litellmUserId: "lu-hire" },
    });
    expect(state.fake.calls).toHaveLength(0);
  });

  it("binds on the Entra id when the placeholder is keyed by the hash of the oid, whatever the UPN says, and the raw oid is never a key (T-SY6, T-SM3; S20)", async () => {
    await seedPendingLinksViaSync(state, [
      { id: "lu-oid", email: "left.email@corp.example", sso: OID_A },
    ]);
    expect(await pendingOf(ssoKey(OID_A))).toBeDefined();
    expect(await pendingOf(OID_A)).toBeUndefined();

    await signIn({
      identity: identityOf({ upn: "totally.different@corp.example" }),
    });

    expect(await linkOf(OID_A)).toMatchObject({ litellmUserId: "lu-oid" });
    expect(await ownerOf("lu-oid")).toBe(OID_A);
    expect(await pendingOf(ssoKey(OID_A))).toBeUndefined();
    expect(state.fake.calls).toHaveLength(0);
  });

  it("the hash is of the lower-cased reference: an upper-case sso_user_id still binds the sign-in with the oid (T-SY6)", async () => {
    await seedPendingLinksViaSync(state, [
      {
        id: "lu-upper",
        email: "left.email@corp.example",
        sso: OID_A.toUpperCase(),
      },
    ]);
    expect(await pendingOf(ssoKey(OID_A))).toBeDefined();
    await signIn({
      identity: identityOf({ upn: "totally.different@corp.example" }),
    });
    expect(await linkOf(OID_A)).toMatchObject({ litellmUserId: "lu-upper" });
  });

  it("sign-in does not depend on LiteLLM being up: the link is made with LiteLLM unreachable (S19)", async () => {
    await seedPendingLinksViaSync(state, [HIRE]);
    installSyncFake(state, { outage: true });
    await signIn();
    expect(await linkOf(OID_A)).toMatchObject({ litellmUserId: "lu-hire" });
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each([
    [
      "a guest UPN with a matching email claim",
      identityOf({
        upn: "new.hire_corp.example#EXT#@corp.onmicrosoft.com",
        email: UPN,
      }),
    ],
    [
      "a matching email claim alone, another UPN",
      identityOf({ upn: "someone.else@corp.example", email: UPN }),
    ],
    ["another tenant with the same UPN", identityOf({ tid: FOREIGN_TENANT })],
  ])(
    "%s binds nothing: no link, the placeholder stays, the sign-in succeeds (Joiner rule; T-SY6)",
    async (_name, identity) => {
      await seedPendingLinksViaSync(state, [HIRE]);
      await signIn({ identity });
      expect(await linkOf(OID_A)).toBeNull();
      // Data model additions; Green A decision (1): the claim names the pending
      // key as owner until a bind moves it.
      expect(await ownerOf("lu-hire")).toBe(UPN.toLowerCase());
      expect(await pendingOf(UPN)).toBeDefined();
    },
  );

  it("an identity that already has another LiteLLM link keeps it: the pending link is removed and nothing is overwritten (T-SY6)", async () => {
    await seedPendingLinksViaSync(state, [HIRE]);
    const { upsertIdentity, links } = await mods();
    await upsertIdentity(identityOf(), new Date());
    ok(
      await links.putIdentityLink(
        {
          oid: OID_A,
          usageIdentities: [],
          aliases: [],
          litellmUserId: "lu-old",
          version: null,
        },
        ctxAt(undefined, "req-old-link"),
      ),
    );

    await signIn();

    expect(await linkOf(OID_A)).toMatchObject({ litellmUserId: "lu-old" });
    expect(await ownerOf("lu-old")).toBe(OID_A);
    expect(await ownerOf("lu-hire")).toBeNull();
    expect(await pendingOf(UPN)).toBeUndefined();
    expect(
      (await recordsOf()).filter(
        (r) => r.action === "identity.litellm-link.set",
      ),
    ).toHaveLength(0);
  });

  it("order at one sign-in: the invite binds first, then the link (T-SM3, SM2); the pending LiteLLM link in the same partition does not break the Joiner", async () => {
    await seedPendingLinksViaSync(state, [HIRE]);
    const { createPendingItem } = await import("./pending");
    ok(
      await createPendingItem(
        { kind: "affiliation", emailOrUpn: UPN, teamId: "team-a" },
        ctxAt(undefined, "req-invite"),
      ),
    );

    await signIn();

    const actions = (await recordsOf()).map((r) => r.action);
    expect(actions).toContain("affiliation.bind");
    expect(actions).toContain("identity.litellm-link.set");
    expect(actions.indexOf("affiliation.bind")).toBeLessThan(
      actions.indexOf("identity.litellm-link.set"),
    );
    expect(await linkOf(OID_A)).toMatchObject({ litellmUserId: "lu-hire" });
  });
});

describe("a user added by hand, then SSO (T-SM3, SM5)", () => {
  const ENTRA_OID = "33333333-3333-4333-8333-333333333333";

  async function dana(withLink: boolean) {
    const { createPasswordUser } = await import("./password-users");
    const { grantRole } = await import("./role-grants");
    const { links } = await mods();
    const { user } = ok(
      await createPasswordUser(
        {
          email: "dana@example.com",
          displayName: "Dana",
          sso: { expectedOid: ENTRA_OID },
        },
        ctxAt(undefined, "req-dana"),
      ),
    );
    if (withLink) {
      ok(
        await links.putIdentityLink(
          {
            oid: user.oid,
            usageIdentities: [],
            aliases: [],
            litellmUserId: "lu-dana",
            version: null,
          },
          ctxAt(undefined, "req-dana-link"),
        ),
      );
    }
    return { user, grantRole };
  }
  const DANA_ENTRA = (over: Partial<SignedInIdentity> = {}) =>
    identityOf({ oid: ENTRA_OID, upn: "dana.upn@example.com", ...over });
  const rawPlaceholder = (key: string, litellmUserId: string) =>
    putRaw({
      PK: `PENDING#${key}`,
      SK: "LITELLMLINK",
      gsi1pk: "PENDINGLITELLMLINKS",
      gsi1sk: `PENDING#${key}`,
      emailOrOid: key,
      litellmUserId,
      source: "sync",
      version: 1,
      createdAt: "2026-11-14T09:00:00.000Z",
      createdBy: "system",
      lastValidatedAt: "2026-11-14T09:00:00.000Z",
    });

  it("the binding moves the person's link to the Entra oid; the link step writes no second link and the placeholder for the same LiteLLM user is deleted (SM5)", async () => {
    await dana(true);
    await rawPlaceholder(ssoKey(ENTRA_OID), "lu-dana");
    await signIn({ identity: DANA_ENTRA() });

    expect(await linkOf(ENTRA_OID)).toMatchObject({ litellmUserId: "lu-dana" });
    expect(await ownerOf("lu-dana")).not.toBeNull();
    expect(await pendingOf(ssoKey(ENTRA_OID))).toBeUndefined();
    const actions = (await recordsOf()).map((r) => r.action);
    expect(actions).toContain("identity.bind.sso");
    expect(actions).not.toContain("identity.litellm-link.set");
  });

  it("a bind that refused to merge (the oid already owns items) gets no automatic link to the LiteLLM user the local identity holds (SM5, T-SM3)", async () => {
    const { user, grantRole } = await dana(true);
    ok(
      await grantRole(
        { oid: ENTRA_OID, role: "internal-admin", reason: "existing" },
        ctxAt(undefined, "req-existing-grant"),
      ),
    );
    await rawPlaceholder(ssoKey(ENTRA_OID), "lu-dana");

    await signIn({ identity: DANA_ENTRA() });

    expect(await linkOf(ENTRA_OID)).toBeNull();
    expect(await linkOf(user.oid)).toMatchObject({ litellmUserId: "lu-dana" });
    expect(await ownerOf("lu-dana")).toBe(user.oid);
    expect(
      (await recordsOf()).filter(
        (r) => r.action === "identity.litellm-link.set",
      ),
    ).toHaveLength(0);
  });
});

describe("a password sign-in makes the link from PENDING#{email} (T-SM4, T-SY6)", () => {
  const PAT = { id: "lu-pat", email: "pat@example.com" };

  async function patSignsIn() {
    const { createPasswordUser } = await import("./password-users");
    const { upsertIdentity, sync } = await mods();
    const { user } = ok(
      await createPasswordUser(
        { email: PAT.email, displayName: "Pat" },
        ctxAt(undefined, "req-pat"),
      ),
    );
    const now = new Date();
    await upsertIdentity(
      {
        oid: user.oid,
        tid: "local",
        email: PAT.email,
        displayName: "Pat",
        roles: [],
        authMethod: "password",
      } as unknown as SignedInIdentity,
      now,
    );
    await sync.applyPasswordSignInLink({
      identity: { oid: user.oid, email: PAT.email },
      requestId: "req-pat-signin",
      now,
    });
    return user;
  }

  it("links with mode sync and actor system, moves the claim, removes the placeholder, and makes no LiteLLM call", async () => {
    await seedPendingLinksViaSync(state, [PAT]);
    const user = await patSignsIn();

    expect(await linkOf(user.oid)).toMatchObject({ litellmUserId: "lu-pat" });
    expect(await ownerOf("lu-pat")).toBe(user.oid);
    expect(await pendingOf(PAT.email)).toBeUndefined();
    const set = (await recordsOf("req-pat-signin")).filter(
      (r) => r.action === "identity.litellm-link.set",
    );
    expect(set).toHaveLength(1);
    expect(set[0]).toMatchObject({
      actor: "system",
      after: { mode: "sync" },
    });
    expect(state.fake.calls).toHaveLength(0);
    expect(writeCalls(state)).toEqual([]);
  });

  it("binds no invite: a pending member under the same email stays pending (SM8; an invite binds only at an SSO sign-in)", async () => {
    await seedPendingLinksViaSync(state, [PAT]);
    const { createPendingItem, listPendingFor } = await import("./pending");
    ok(
      await createPendingItem(
        { kind: "affiliation", emailOrUpn: PAT.email, teamId: "team-a" },
        ctxAt(undefined, "req-pat-invite"),
      ),
    );
    const user = await patSignsIn();
    const { getAffiliation } = await import("./affiliations");
    expect(await getAffiliation(user.oid)).toBeNull();
    expect(await listPendingFor([PAT.email])).toHaveLength(1);
  });
});
