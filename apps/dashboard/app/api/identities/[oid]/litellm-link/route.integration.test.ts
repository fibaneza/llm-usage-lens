import { describe, expect, it, vi } from "vitest";

import {
  getIdentityLink,
  getLiteLLMUserOwner,
  putIdentityLink,
} from "@/lib/data/access/identity-links";
import {
  expectNoSentinels,
  signInWithRoles,
  useEnv,
} from "@/test/fakes/fake-litellm-views";
import {
  AUDIT_DAY,
  PEOPLE,
  expectError,
  installMemberWritesFake,
  send,
  setupMemberWritesSuite,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/support/litellm-member-writes-support";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import { ctxAt, ok } from "@/test/support/access-test-support";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user links"
// (D16, unit M3: admin and org-admin write; never on oneself, `403` before
// parsing with one `denied` record; match needs the identity's verified
// canonical email, else `409`; manual needs a reason of 1-280 characters,
// `400` without; one-to-one `LiteLLMUserClaim`, duplicate `409 CONFLICT`;
// privileged targets `409 PRIVILEGED_TARGET`; audited with mode, both ids and
// the reason; open access mode `403 OPERATION_UNAVAILABLE`, decision
// 2026-11-18), "API routes (additions)", threat T-MI1; LiteLLM spec LT11,
// LT18, "API routes" error codes. The 401, 403-before-parse for the refused
// roles, 400 shape, no-store and one-denied cases are the shared
// route-contract suite's (registry entries in test/route-registry.ts, Rule
// 60.23); this file adds the lead, own-oid and route-specific cases. LiteLLM is
// the in-process fake (Rule 60.24).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const PATTERN = "/api/identities/[oid]/litellm-link";
const state = setupMemberWritesSuite();
const alice = PEOPLE.alice;
const bob = PEOPLE.bob;

async function run(
  method: "PUT" | "DELETE",
  oid: string,
  body: unknown,
  pathOid = oid,
) {
  stubLiteLLMEnv();
  const handler = (await import("./route"))[method];
  return send(handler, {
    method,
    path: `/api/identities/${pathOid}/litellm-link`,
    params: { oid },
    body,
  });
}
const put = (oid: string, body: unknown) => run("PUT", oid, body);
const del = (oid: string, body: unknown) => run("DELETE", oid, body);
const manual = (litellmUserId: string, over = {}) => ({
  litellmUserId,
  mode: "manual",
  reason: "Same person, other email",
  version: 0,
  ...over,
});
const match = (litellmUserId: string, over = {}) => ({
  litellmUserId,
  mode: "match",
  version: 0,
  ...over,
});

async function linkRecords() {
  const { listAuditRecords } = await import("@/lib/data/access/audit");
  return (await listAuditRecords(AUDIT_DAY)).filter((r) =>
    r.action.startsWith("identity.litellm-link"),
  );
}
const denied = async () =>
  (await linkRecords()).filter((r) => r.result === "denied");
const succeeded = async () =>
  (await linkRecords()).filter((r) => r.result === "success");

describe("PUT /api/identities/[oid]/litellm-link", () => {
  describe("who may link (T-MI1: admin and org-admin only)", () => {
    it.each(["admin", "orgAdmin"] as CallerName[])(
      "%s links (match) and gets only oid, litellmUserId and version",
      async (who) => {
        signInAs(who);
        const { res, body, text } = await put(alice.oid, match(alice.email));
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(body.data).toEqual({
          oid: alice.oid,
          litellmUserId: alice.email,
          version: 1,
        });
        expectNoSentinels(text);
        expect(await getLiteLLMUserOwner(alice.email)).toBe(alice.oid);
      },
    );

    it.each([
      "teamAdminA",
      "deptAdminEng",
      "auditor",
      "memberA",
      "viewerNone",
      "noRole",
    ] as const)(
      "%s gets 403: no LiteLLM call, no link, one denied record",
      async (who) => {
        if (who === "noRole") await signInWithRoles([]);
        else signInAs(who);
        const { res } = await put(alice.oid, match(alice.email));
        await expectError(res, 403, "FORBIDDEN");
        expect(state.fake.calls).toHaveLength(0);
        expect(await getIdentityLink(alice.oid)).toBeNull();
        const records = await denied();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          action: "identity.litellm-link.set",
          code: "FORBIDDEN",
          route: { method: "PUT", pattern: PATTERN },
        });
        expect(await succeeded()).toHaveLength(0);
      },
    );

    it("403 comes before parsing for a lead: an invalid body is still 403, not 400", async () => {
      signInAs("teamAdminA");
      const { res } = await put(alice.oid, { nonsense: true });
      await expectError(res, 403, "FORBIDDEN");
    });
  });

  describe("never on oneself (no self-link; 403 before parsing, one denied)", () => {
    it.each(["admin", "orgAdmin"] as CallerName[])(
      "%s linking its own oid is 403 even with an invalid body",
      async (who) => {
        signInAs(who);
        const own = CALLERS[who].oid;
        const { res } = await put(own, { nonsense: true });
        await expectError(res, 403, "FORBIDDEN");
        expect(state.fake.calls).toHaveLength(0);
        const records = await denied();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          action: "identity.litellm-link.set",
          actor: own,
          route: { method: "PUT", pattern: PATTERN },
        });
        expect(await getIdentityLink(own)).toBeNull();
      },
    );

    it("a valid body for the own oid is 403 as well, nothing written", async () => {
      signInAs("admin");
      const { res } = await put(
        CALLERS.admin.oid,
        manual("someone@company.com"),
      );
      await expectError(res, 403, "FORBIDDEN");
      expect(await getLiteLLMUserOwner("someone@company.com")).toBeNull();
    });
  });

  describe("match (verified canonical email; approval is the client's click, never automatic)", () => {
    it("writes the link, its claim and an audit record with mode and both ids, in one go", async () => {
      signInAs("orgAdmin");
      const { res } = await put(alice.oid, match(alice.email));
      expect(res.status).toBe(200);
      const [record, ...rest] = await succeeded();
      expect(rest).toHaveLength(0);
      expect(record).toMatchObject({
        action: "identity.litellm-link.set",
        actor: CALLERS.orgAdmin.oid,
        category: "change",
        target: { type: "identity", id: alice.oid },
        after: {
          oid: alice.oid,
          litellmUserId: alice.email,
          mode: "match",
          version: 1,
        },
      });
      expect(await getLiteLLMUserOwner(alice.email)).toBe(alice.oid);
      expect(writeCalls(state)).toHaveLength(0);
    });

    it("409 when the LiteLLM user's email differs from the identity's, nothing written", async () => {
      signInAs("admin");
      const { res } = await put(alice.oid, match(bob.email));
      await expectError(res, 409, "CONFLICT");
      expect(await getIdentityLink(alice.oid)).toBeNull();
      expect(await getLiteLLMUserOwner(bob.email)).toBeNull();
      expect(await succeeded()).toHaveLength(0);
    });
  });

  describe("manual (emails differ; a reason of 1-280 characters)", () => {
    it("links with a reason, auditing mode, both ids and the reason, and keeping them out of the response", async () => {
      signInAs("admin");
      const { res, body } = await put(alice.oid, manual(bob.email));
      expect(res.status).toBe(200);
      expect(Object.keys(body.data).sort()).toEqual([
        "litellmUserId",
        "oid",
        "version",
      ]);
      const [record] = await succeeded();
      expect(record?.after).toMatchObject({
        oid: alice.oid,
        litellmUserId: bob.email,
        mode: "manual",
        reason: "Same person, other email",
      });
    });

    it.each([
      ["no reason", { reason: undefined }],
      ["a blank reason", { reason: "   " }],
      ["a reason over 280 characters", { reason: "x".repeat(281) }],
    ])("400 with %s, no LiteLLM call and nothing written", async (_n, over) => {
      signInAs("admin");
      const { res } = await put(alice.oid, manual(bob.email, over));
      await expectError(res, 400, "BAD_REQUEST");
      expect(state.fake.calls).toHaveLength(0);
      expect(await getIdentityLink(alice.oid)).toBeNull();
    });

    it("accepts a reason of exactly 280 characters", async () => {
      signInAs("admin");
      const { res } = await put(
        alice.oid,
        manual(bob.email, { reason: "x".repeat(280) }),
      );
      expect(res.status).toBe(200);
    });
  });

  describe("one-to-one claim (duplicate 409 CONFLICT, no write)", () => {
    it("409 when another identity already holds the LiteLLM user (set by the same route)", async () => {
      signInAs("admin");
      expect((await put(bob.oid, manual("shared-lu"))).res.status).toBe(200);
      const { res } = await put(alice.oid, manual("shared-lu"));
      await expectError(res, 409, "CONFLICT");
      expect(await getIdentityLink(alice.oid)).toBeNull();
      expect(await getLiteLLMUserOwner("shared-lu")).toBe(bob.oid);
      expect(await succeeded()).toHaveLength(1);
    });

    it("409 for a LiteLLM user linked before this route existed (a1@company.com is memberA's seeded link)", async () => {
      signInAs("admin");
      const { res } = await put(alice.oid, manual("a1@company.com"));
      await expectError(res, 409, "CONFLICT");
      expect(await getIdentityLink(alice.oid)).toBeNull();
    });

    it("409 for a stale or wrong version, nothing written", async () => {
      signInAs("admin");
      ok(
        await putIdentityLink(
          {
            oid: alice.oid,
            usageIdentities: [],
            aliases: [],
            version: null,
          },
          ctxAt(undefined, "req-seed-link"),
        ),
      );
      const stale = await put(alice.oid, manual(bob.email, { version: 0 }));
      await expectError(stale.res, 409, "CONFLICT");
      const wrong = await put(alice.oid, manual(bob.email, { version: 9 }));
      await expectError(wrong.res, 409, "CONFLICT");
      expect((await getIdentityLink(alice.oid))?.litellmUserId).toBeUndefined();
    });

    it("an existing link is updated with its version and keeps its usage identities", async () => {
      signInAs("admin");
      ok(
        await putIdentityLink(
          {
            oid: alice.oid,
            usageIdentities: ["alice@company.com"],
            aliases: ["alice-sso"],
            version: null,
          },
          ctxAt(undefined, "req-seed-link"),
        ),
      );
      const { res, body } = await put(
        alice.oid,
        manual(bob.email, { version: 1 }),
      );
      expect(res.status).toBe(200);
      expect(body.data.version).toBe(2);
      expect(await getIdentityLink(alice.oid)).toMatchObject({
        usageIdentities: ["alice@company.com"],
        aliases: ["alice-sso"],
        litellmUserId: bob.email,
      });
    });
  });

  describe("privileged targets (LT18: 409 PRIVILEGED_TARGET, no link written)", () => {
    it.each([
      ["proxy_admin", "manual"],
      ["proxy_admin_viewer", "manual"],
      ["proxy_admin", "match"],
    ])("a %s target is refused in %s mode", async (role, mode) => {
      installMemberWritesFake(state, { roles: { [alice.email]: role } });
      signInAs("admin");
      const body = mode === "match" ? match(alice.email) : manual(alice.email);
      const { res } = await put(alice.oid, body);
      await expectError(res, 409, "PRIVILEGED_TARGET");
      expect(await getIdentityLink(alice.oid)).toBeNull();
      expect(await getLiteLLMUserOwner(alice.email)).toBeNull();
      expect(await succeeded()).toHaveLength(0);
      const records = await denied();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "identity.litellm-link.set",
        code: "PRIVILEGED_TARGET",
      });
    });

    it.each(["internal_user", "internal_user_viewer"])(
      "a %s target may be linked",
      async (role) => {
        installMemberWritesFake(state, { roles: { [alice.email]: role } });
        signInAs("admin");
        const { res } = await put(alice.oid, match(alice.email));
        expect(res.status).toBe(200);
      },
    );
  });

  describe("availability", () => {
    it("503 LITELLM_UNAVAILABLE when LiteLLM is down, nothing written", async () => {
      installMemberWritesFake(state, { outage: true });
      signInAs("admin");
      const { res } = await put(alice.oid, match(alice.email));
      await expectError(res, 503, "LITELLM_UNAVAILABLE");
      expect(await getIdentityLink(alice.oid)).toBeNull();
    });

    it("open access mode is 403 OPERATION_UNAVAILABLE with no LiteLLM call and no write (LT11)", async () => {
      signInAs("admin");
      useEnv({ AUTH_ACCESS_MODE: "open" });
      const { res } = await put(alice.oid, match(alice.email));
      await expectError(res, 403, "OPERATION_UNAVAILABLE");
      expect(state.fake.calls).toHaveLength(0);
      expect(await getIdentityLink(alice.oid)).toBeNull();
    });
  });
});

describe("DELETE /api/identities/[oid]/litellm-link", () => {
  async function linked(oid = alice.oid, id = alice.email) {
    signInAs("admin");
    const first = await put(
      oid,
      manual(id, { reason: "Contractor alias", version: 0 }),
    );
    expect(first.res.status).toBe(200);
    return first.body.data.version as number;
  }

  it.each(["admin", "orgAdmin"] as CallerName[])(
    "%s unlinks: the claim is released and the record carries mode, both ids and the reason",
    async (who) => {
      const version = await linked();
      signInAs(who);
      const { res, body } = await del(alice.oid, { version });
      expect(res.status).toBe(200);
      expect(body.data).toEqual({
        oid: alice.oid,
        litellmUserId: null,
        version: version + 1,
      });
      expect(await getLiteLLMUserOwner(alice.email)).toBeNull();
      expect((await getIdentityLink(alice.oid))?.litellmUserId).toBeUndefined();
      const removals = (await succeeded()).filter(
        (r) => r.action === "identity.litellm-link.remove",
      );
      expect(removals).toHaveLength(1);
      expect(removals[0]).toMatchObject({
        actor: CALLERS[who].oid,
        target: { type: "identity", id: alice.oid },
        before: {
          oid: alice.oid,
          litellmUserId: alice.email,
          mode: "manual",
          reason: "Contractor alias",
        },
      });
    },
  );

  it("the released LiteLLM user can be linked to another identity", async () => {
    const version = await linked();
    signInAs("admin");
    expect((await del(alice.oid, { version })).res.status).toBe(200);
    expect((await put(bob.oid, manual(alice.email))).res.status).toBe(200);
  });

  it.each([
    "teamAdminA",
    "deptAdminEng",
    "auditor",
    "memberA",
    "viewerNone",
  ] as CallerName[])(
    "%s gets 403, the link stays and one denied is written",
    async (who) => {
      const version = await linked();
      signInAs(who);
      const { res } = await del(alice.oid, { version });
      await expectError(res, 403, "FORBIDDEN");
      expect((await getIdentityLink(alice.oid))?.litellmUserId).toBe(
        alice.email,
      );
      const records = await denied();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "identity.litellm-link.remove",
        route: { method: "DELETE", pattern: PATTERN },
      });
    },
  );

  it.each(["admin", "orgAdmin"] as CallerName[])(
    "%s unlinking its own oid is 403 before parsing, one denied record",
    async (who) => {
      signInAs(who);
      const { res } = await del(CALLERS[who].oid, { nonsense: true });
      await expectError(res, 403, "FORBIDDEN");
      const records = await denied();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "identity.litellm-link.remove",
        actor: CALLERS[who].oid,
      });
    },
  );

  it("409 for a stale version, the link stays", async () => {
    const version = await linked();
    const { res } = await del(alice.oid, { version: version + 5 });
    await expectError(res, 409, "CONFLICT");
    expect((await getIdentityLink(alice.oid))?.litellmUserId).toBe(alice.email);
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE (LT11)", async () => {
    const version = await linked();
    useEnv({ AUTH_ACCESS_MODE: "open" });
    const { res } = await del(alice.oid, { version });
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
    expect((await getIdentityLink(alice.oid))?.litellmUserId).toBe(alice.email);
  });
});
