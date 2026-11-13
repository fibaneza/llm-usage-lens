import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ENTRA_ISSUER,
  FOREIGN_TENANT,
  GOOD_PASSWORD,
  TENANT,
  fakeEnvelope,
} from "@/lib/auth/password-test-support";
import { clearTable, ensureTestTable, putRaw } from "@/test/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("./access-test-support").then((m) => m.faultyDynamodb()),
);
vi.mock("@/env", async (orig) => ({
  env: {
    ...(await orig<typeof import("@/env")>()).env,
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: ENTRA_ISSUER,
  },
}));
vi.mock("@/lib/auth/secret-envelope", () => fakeEnvelope);

import { completePasswordSetup } from "@/lib/auth/password-setup";
import { authorizePasswordUser } from "@/lib/auth/password-credentials";

import {
  CURSOR_SECRET,
  NOW,
  OID_A,
  OID_B,
  auditRecords,
  ctxAt,
  ok,
} from "./access-test-support";
import { grantAdminScope, listAdminScopes } from "./admin-scopes";
import { addMember, getAffiliation } from "./affiliations";
import { getIdentityLink, putIdentityLink } from "./identity-links";
import { createPasswordUser, getPasswordUser } from "./password-users";
import { grantRole, listRoleGrants } from "./role-grants";
import { bindPasswordUserOnEntraSignIn } from "./sso-binding";

// Source: docs/specs/2026-11-10-access-control.md — "SSO reference and
// binding" (D25), threats T2, T7, T26, T28. The tenant is read from the
// configured Entra issuer (`@/env`), so the signature stays
// bindPasswordUserOnEntraSignIn(claims, ctx) (R2b contract).
// A bind writes its own audit record with actor "system" regardless of ctx.actor.
const ctx = ctxAt();
const ENTRA_OID = "33333333-3333-4333-8333-333333333333";
const OPTS = { cursorSecret: CURSOR_SECRET };

beforeAll(ensureTestTable);
beforeEach(clearTable);

async function seedUser(
  email: string,
  sso?: { expectedUpn?: string; expectedOid?: string },
) {
  const { user } = ok(
    await createPasswordUser(
      { email, displayName: "Test User", ...(sso ? { sso } : {}) },
      ctx,
    ),
  );
  ok(
    await grantRole(
      { oid: user.oid, role: "internal-org-admin", reason: "seed" },
      ctx,
    ),
  );
  ok(await addMember({ oid: user.oid, teamId: "t1" }, ctx));
  ok(
    await grantAdminScope(
      { oid: user.oid, scopeType: "team", scopeId: "t1" },
      ctx,
    ),
  );
  ok(
    await putIdentityLink(
      {
        oid: user.oid,
        usageIdentities: [email],
        aliases: ["dana-alias"],
        version: null,
      },
      ctx,
    ),
  );
  return user;
}

describe("bindPasswordUserOnEntraSignIn", () => {
  it("binds on tenant + expectedOid even when the UPN differs", async () => {
    const user = await seedUser("dana@example.com", { expectedOid: ENTRA_OID });
    const result = await bindPasswordUserOnEntraSignIn(
      {
        oid: ENTRA_OID,
        tid: TENANT,
        preferredUsername: "somebody.else@example.com",
      },
      ctx,
    );
    expect(result).toEqual({ bound: true, fromIdentityId: user.oid });
  });

  it("binds on expectedUpn case-insensitively when no expectedOid is set", async () => {
    const user = await seedUser("dana@example.com", {
      expectedUpn: "Dana.Upn@Example.com",
    });
    const result = await bindPasswordUserOnEntraSignIn(
      {
        oid: ENTRA_OID,
        tid: TENANT,
        preferredUsername: "DANA.UPN@example.COM",
      },
      ctx,
    );
    expect(result).toEqual({ bound: true, fromIdentityId: user.oid });
  });

  it("does not fall back to the UPN when expectedOid is set and differs (D25)", async () => {
    await seedUser("dana@example.com", {
      expectedOid: OID_B,
      expectedUpn: "dana.upn@example.com",
    });
    expect(
      await bindPasswordUserOnEntraSignIn(
        {
          oid: ENTRA_OID,
          tid: TENANT,
          preferredUsername: "dana.upn@example.com",
        },
        ctx,
      ),
    ).toEqual({ bound: false });
  });

  it("never matches the user's email when expectedUpn differs (email claim is not a bind key, T2)", async () => {
    await seedUser("dana@example.com", { expectedUpn: "dana.upn@example.com" });
    expect(
      await bindPasswordUserOnEntraSignIn(
        { oid: ENTRA_OID, tid: TENANT, preferredUsername: "dana@example.com" },
        ctx,
      ),
    ).toEqual({ bound: false });
  });

  it("never binds on a guest #EXT# UPN", async () => {
    const guest = "dana_example.com#EXT#@tenant.onmicrosoft.com";
    await seedUser("dana@example.com", { expectedUpn: guest });
    expect(
      await bindPasswordUserOnEntraSignIn(
        { oid: ENTRA_OID, tid: TENANT, preferredUsername: guest },
        ctx,
      ),
    ).toEqual({ bound: false });
  });

  it("binds nothing for a foreign tenant and leaves the user untouched", async () => {
    const user = await seedUser("dana@example.com", { expectedOid: ENTRA_OID });
    expect(
      await bindPasswordUserOnEntraSignIn(
        { oid: ENTRA_OID, tid: FOREIGN_TENANT },
        ctx,
      ),
    ).toEqual({ bound: false });
    expect((await getPasswordUser("dana@example.com"))?.status).toBe("enabled");
    expect(await getAffiliation(user.oid)).not.toBeNull();
  });

  it("returns { bound: false } and writes no audit record when nobody matches", async () => {
    const before = (await auditRecords()).length;
    expect(
      await bindPasswordUserOnEntraSignIn(
        {
          oid: ENTRA_OID,
          tid: TENANT,
          preferredUsername: "nobody@example.com",
        },
        ctx,
      ),
    ).toEqual({ bound: false });
    expect((await auditRecords()).length).toBe(before);
  });

  it("moves every local: item to the Entra oid in one bind and leaves nothing behind", async () => {
    const user = await seedUser("dana@example.com", { expectedOid: ENTRA_OID });
    expect(
      await bindPasswordUserOnEntraSignIn({ oid: ENTRA_OID, tid: TENANT }, ctx),
    ).toEqual({ bound: true, fromIdentityId: user.oid });

    expect(await getAffiliation(ENTRA_OID)).toMatchObject({
      oid: ENTRA_OID,
      teamId: "t1",
    });
    expect(await getAffiliation(user.oid)).toBeNull();

    const scopes = ok(await listAdminScopes(ENTRA_OID, OPTS)).items;
    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toMatchObject({
      oid: ENTRA_OID,
      scopeType: "team",
      scopeId: "t1",
    });
    expect(ok(await listAdminScopes(user.oid, OPTS)).items).toHaveLength(0);

    const grants = ok(await listRoleGrants({ ...OPTS, limit: 50 })).items;
    expect(
      grants.filter((g) => g.oid === ENTRA_OID).map((g) => g.role),
    ).toEqual(["internal-org-admin"]);
    expect(grants.some((g) => g.oid === user.oid)).toBe(false);

    expect(await getIdentityLink(ENTRA_OID)).toMatchObject({
      oid: ENTRA_OID,
      usageIdentities: ["dana@example.com"],
      aliases: ["dana-alias"],
    });
    expect(await getIdentityLink(user.oid)).toBeNull();

    // usage-key claims moved: the key is still unique to the (new) owner.
    expect(
      await putIdentityLink(
        {
          oid: OID_A,
          usageIdentities: ["dana@example.com"],
          aliases: [],
          version: null,
        },
        ctx,
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("binds when both the local: identity and the Entra oid already have an IDENT#/META item", async () => {
    const user = await seedUser("dana@example.com", { expectedOid: ENTRA_OID });
    for (const [oid, tid] of [
      [user.oid, "local"],
      [ENTRA_OID, TENANT],
    ] as const) {
      await putRaw({
        PK: `IDENT#${oid}`,
        SK: "META",
        gsi1pk: "IDENTS",
        gsi1sk: `IDENT#${oid}`,
        oid,
        tid,
        version: 1,
      });
    }
    expect(
      await bindPasswordUserOnEntraSignIn(
        { oid: ENTRA_OID, tid: TENANT },
        ctxAt(NOW, "req-bind"),
      ),
    ).toEqual({ bound: true, fromIdentityId: user.oid });
    expect(await getAffiliation(ENTRA_OID)).toMatchObject({ teamId: "t1" });
    expect(await getAffiliation(user.oid)).toBeNull();
    const added = (await auditRecords()).filter(
      (r) => r.requestId === "req-bind",
    );
    expect(added.map((r) => r.action)).toEqual(["identity.bind.sso"]);
  });

  it("sets status sso-bound with tid, oid and boundAt, and releases the reservations", async () => {
    await seedUser("dana@example.com", {
      expectedOid: ENTRA_OID,
      expectedUpn: "dana.upn@example.com",
    });
    await bindPasswordUserOnEntraSignIn(
      { oid: ENTRA_OID, tid: TENANT },
      ctxAt(NOW, "req-bind"),
    );
    expect(await getPasswordUser("dana@example.com")).toMatchObject({
      status: "sso-bound",
      sso: { tid: TENANT, oid: ENTRA_OID, boundAt: NOW.toISOString() },
    });
    ok(
      await createPasswordUser(
        {
          email: "other@example.com",
          displayName: "Other",
          sso: { expectedUpn: "dana.upn@example.com", expectedOid: ENTRA_OID },
        },
        ctx,
      ),
    );
  });

  it("writes exactly one identity.bind.sso record with actor system and both ids", async () => {
    const user = await seedUser("dana@example.com", { expectedOid: ENTRA_OID });
    const before = (await auditRecords()).length;
    await bindPasswordUserOnEntraSignIn(
      { oid: ENTRA_OID, tid: TENANT },
      ctxAt(NOW, "req-bind"),
    );
    const added = (await auditRecords()).filter(
      (r) => r.requestId === "req-bind",
    );
    expect((await auditRecords()).length).toBe(before + 1);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      action: "identity.bind.sso",
      actor: "system",
      result: "success",
    });
    const json = JSON.stringify(added[0]);
    expect(json).toContain(user.oid);
    expect(json).toContain(ENTRA_OID);
  });

  it("does not merge when the Entra oid already owns items: bound false, local items stay, conflict flagged (T26)", async () => {
    const user = await seedUser("dana@example.com", { expectedOid: ENTRA_OID });
    ok(
      await grantRole(
        { oid: ENTRA_OID, role: "internal-admin", reason: "existing" },
        ctx,
      ),
    );
    expect(
      await bindPasswordUserOnEntraSignIn(
        { oid: ENTRA_OID, tid: TENANT },
        ctxAt(NOW, "req-bind"),
      ),
    ).toEqual({ bound: false });
    expect(await getAffiliation(user.oid)).not.toBeNull();
    expect(await getAffiliation(ENTRA_OID)).toBeNull();
    expect(await getPasswordUser("dana@example.com")).toMatchObject({
      status: "enabled",
      ssoConflict: true,
    });
    expect(
      ok(await listRoleGrants({ ...OPTS, limit: 50 }))
        .items.filter((g) => g.oid === ENTRA_OID)
        .map((g) => g.role),
    ).toEqual(["internal-admin"]);
  });

  it("is not repeatable: a second sign-in after binding reports bound false", async () => {
    await seedUser("dana@example.com", { expectedOid: ENTRA_OID });
    await bindPasswordUserOnEntraSignIn({ oid: ENTRA_OID, tid: TENANT }, ctx);
    expect(
      await bindPasswordUserOnEntraSignIn({ oid: ENTRA_OID, tid: TENANT }, ctx),
    ).toEqual({
      bound: false,
    });
  });

  it(
    "refuses password sign-in after binding (T7, T28)",
    { timeout: 30_000 },
    async () => {
      const { user, setupToken } = ok(
        await createPasswordUser(
          {
            email: "dana@example.com",
            displayName: "Dana",
            sso: { expectedOid: ENTRA_OID },
          },
          ctx,
        ),
      );
      const done = await completePasswordSetup(
        { token: setupToken, password: GOOD_PASSWORD },
        { now: () => NOW },
      );
      expect(done.ok).toBe(true);
      expect(
        await authorizePasswordUser(
          { email: "dana@example.com", password: GOOD_PASSWORD },
          { now: () => NOW },
        ),
      ).not.toBeNull();
      expect(
        await bindPasswordUserOnEntraSignIn(
          { oid: ENTRA_OID, tid: TENANT },
          ctxAt(NOW, "req-bind"),
        ),
      ).toEqual({ bound: true, fromIdentityId: user.oid });
      expect(
        await authorizePasswordUser(
          { email: "dana@example.com", password: GOOD_PASSWORD },
          { now: () => NOW },
        ),
      ).toBeNull();
    },
  );
});
