import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";

import { ok } from "@/lib/data/access/access-test-support";
import { resetDeniedAudit } from "@/lib/data/access/audit";
import { grantRole } from "@/lib/data/access/role-grants";
import {
  getIdentityLink,
  putIdentityLink,
} from "@/lib/data/access/identity-links";
import {
  CALLERS,
  MISSING,
  PEOPLE,
  affiliationOf,
  auditToday,
  deniedToday,
  expectData,
  expectError,
  expectOneDenied,
  expectSameBody,
  invoke,
  nonAuditItems,
  scopesOf,
  seedCtx,
  seedWorld,
  signInAs,
  type CallerName,
} from "@/test/matrix-route-support";
import { clearTable, ensureTestTable, putRaw } from "@/test/test-support";

import { GET as GET_LIST } from "./identities/route";
import {
  GET as GET_LINK,
  PUT as PUT_LINK,
} from "./identities/[oid]/links/route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/identities GET and /api/identities/[oid]/links GET, PUT:
// internal-admin, GET also internal-auditor), "Roles" (configuration: identity
// links, internal-admin only), "Permission matrix" (identity links: an alias or
// usage identity belongs to one person, duplicate -> 409; links show a person
// their own usage and never grant access), "Canonical usage identity"
// (lower-cased email; matching exact), "Data model additions" (IdentityLink,
// UsageKeyClaim; every mutable item carries `version`; access review reads
// Query GSI1=IDENTS), "Enforcement" items 2, 4, 6, "Audit log"
// (identity.link.update; D17/T22), threats T15, T17. Contract:
// contract-slice1.md. Version convention (as for visibility): GET of a person
// without a link returns the empty link at version 0, and a PUT with version 0
// creates (putIdentityLink version null). Only `@/auth` is mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const LINKS = "/api/identities/[oid]/links";
const alice = PEOPLE.alice;
const bob = PEOPLE.bob;

const listIdentities = (query = "") =>
  invoke(GET_LIST, { method: "GET", path: `/api/identities${query}` });
const getLink = (oid: string) =>
  invoke(GET_LINK, {
    method: "GET",
    path: `/api/identities/${oid}/links`,
    params: { oid },
  });
const putLink = (oid: string, body: unknown, extra = {}) =>
  invoke(PUT_LINK, {
    method: "PUT",
    path: `/api/identities/${oid}/links`,
    params: { oid },
    body,
    ...extra,
  });
const link = (version: number, over = {}) => ({
  usageIdentities: ["alice@company.com"],
  aliases: ["alice-sso"],
  litellmUserId: "u-alice",
  version,
  ...over,
});

type Item = {
  oid: string;
  email?: string;
  displayName?: string;
  authMethod: string;
  lastSignInAt: string;
};
type Link = {
  oid: string;
  usageIdentities: string[];
  aliases: string[];
  litellmUserId?: string;
  version: number;
};

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  await seedWorld();
  signInAs("admin");
});

const CANNOT_READ: CallerName[] = [
  "orgAdmin",
  "teamAdminA",
  "deptAdminEng",
  "memberA",
  "viewerNone",
];
const CANNOT_WRITE: CallerName[] = ["auditor", ...CANNOT_READ];

describe("GET /api/identities", () => {
  it("401 without a session", async () => {
    signInAs(null);
    await expectError(await listIdentities(), 401, "UNAUTHORIZED");
  });

  it.each(CANNOT_READ)(
    "%s: 403 FORBIDDEN with no data in the body, and no denied record (reads are metric-only)",
    async (caller) => {
      signInAs(caller);
      await expectError(await listIdentities(), 403, "FORBIDDEN");
      expect(await deniedToday()).toEqual([]);
    },
  );

  it.each(["admin", "auditor"] as const)(
    "%s lists every identity as { data: { items } } with no-store, without lockout state",
    async (caller) => {
      signInAs(caller);
      const data = await expectData<{ items: Item[]; cursor?: string }>(
        await listIdentities(),
      );
      expect(data.items.map((i) => i.oid).sort()).toEqual(
        Object.values(PEOPLE)
          .map((p) => p.oid)
          .sort(),
      );
      const row = data.items.find((i) => i.oid === alice.oid);
      expect(row).toMatchObject({
        oid: alice.oid,
        email: alice.email,
        displayName: alice.name,
        authMethod: "entra",
        lastSignInAt: "2026-01-01T00:00:00.000Z",
      });
      expect(JSON.stringify(data)).not.toContain("failedAttempts");
      expect(JSON.stringify(data)).not.toContain("lockedUntil");
      expect(data.cursor).toBeUndefined();
    },
  );

  it("lists a password-setup identity (authMethod password) instead of failing the whole list - Access Control spec Password users, D20-D22", async () => {
    const oid = "00000000-0000-4000-8000-0000000000aa";
    await putRaw({
      PK: `IDENT#${oid}`,
      SK: "META",
      gsi1pk: "IDENTS",
      gsi1sk: `IDENT#${oid}`,
      oid,
      tid: "local",
      email: "pw@example.com",
      lastSignInAt: "2026-01-02T00:00:00.000Z",
      lastSeenRoles: ["internal-viewer"],
      authMethod: "password",
      version: 1,
    });
    const data = await expectData<{ items: Item[] }>(await listIdentities());
    expect(data.items.find((i) => i.oid === oid)).toMatchObject({
      email: "pw@example.com",
      authMethod: "password",
    });
    expect(data.items).toHaveLength(Object.keys(PEOPLE).length + 1);
  });

  it("an empty table is 200 with no items", async () => {
    await clearTable();
    const data = await expectData<{ items: Item[] }>(await listIdentities());
    expect(data.items).toEqual([]);
  });

  it("paginates over GSI1=IDENTS with ?limit and an opaque cursor, following it to the end", async () => {
    const first = await expectData<{ items: Item[]; cursor?: string }>(
      await listIdentities("?limit=3"),
    );
    expect(first.items).toHaveLength(3);
    expect(typeof first.cursor).toBe("string");
    expect(first.cursor).not.toContain("IDENT");
    const second = await expectData<{ items: Item[]; cursor?: string }>(
      await listIdentities(
        `?limit=3&cursor=${encodeURIComponent(first.cursor!)}`,
      ),
    );
    expect(second.items).toHaveLength(1);
    expect(second.cursor).toBeUndefined();
    expect([...first.items, ...second.items].map((i) => i.oid).sort()).toEqual(
      Object.values(PEOPLE)
        .map((p) => p.oid)
        .sort(),
    );
  });

  it.each([
    ["a tampered cursor", "?cursor=not-a-real-cursor"],
    ["a zero limit", "?limit=0"],
    ["a non-numeric limit", "?limit=abc"],
  ])("400 BAD_REQUEST for %s", async (_n, query) => {
    await expectError(await listIdentities(query), 400, "BAD_REQUEST");
  });
});

describe("GET /api/identities/[oid]/links", () => {
  it("401 without a session", async () => {
    signInAs(null);
    await expectError(await getLink(alice.oid), 401, "UNAUTHORIZED");
  });

  it.each(CANNOT_READ)(
    "%s: 403 FORBIDDEN with no data in the body",
    async (caller) => {
      ok(
        await putIdentityLink(
          { ...link(0), oid: alice.oid, version: null },
          seedCtx(),
        ),
      );
      signInAs(caller);
      await expectError(await getLink(alice.oid), 403, "FORBIDDEN");
      expect(await deniedToday()).toEqual([]);
    },
  );

  it.each(["admin", "auditor"] as const)(
    "%s reads the empty link at version 0 for a person without one",
    async (caller) => {
      signInAs(caller);
      expect(await expectData<Link>(await getLink(alice.oid))).toMatchObject({
        oid: alice.oid,
        usageIdentities: [],
        aliases: [],
        version: 0,
      });
    },
  );

  it.each(["admin", "auditor"] as const)(
    "%s reads the stored link with its version",
    async (caller) => {
      ok(
        await putIdentityLink(
          { ...link(0), oid: alice.oid, version: null },
          seedCtx(),
        ),
      );
      signInAs(caller);
      expect(await expectData<Link>(await getLink(alice.oid))).toMatchObject({
        oid: alice.oid,
        usageIdentities: ["alice@company.com"],
        aliases: ["alice-sso"],
        litellmUserId: "u-alice",
        version: 1,
      });
    },
  );

  it("404 NOT_FOUND for an identity that does not exist, with a body that does not echo the id", async () => {
    const a = await expectError(await getLink(MISSING), 404, "NOT_FOUND");
    const b = await expectError(
      await getLink("also-missing"),
      404,
      "NOT_FOUND",
    );
    expectSameBody(a, b, MISSING, "also-missing");
  });

  it("400 BAD_REQUEST for a malformed path oid", async () => {
    await expectError(await getLink("x".repeat(129)), 400, "BAD_REQUEST");
  });
});

describe("PUT /api/identities/[oid]/links", () => {
  it("creates a link with version 0: stored at version 1, one identity.link.update success record, and it grants no access", async () => {
    const data = await expectData<Link>(await putLink(alice.oid, link(0)));
    expect(data).toMatchObject({
      oid: alice.oid,
      usageIdentities: ["alice@company.com"],
      aliases: ["alice-sso"],
      litellmUserId: "u-alice",
      version: 1,
    });
    expect(await getIdentityLink(alice.oid)).toMatchObject({ version: 1 });
    const records = await auditToday();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "identity.link.update",
      result: "success",
      category: "change",
      actor: CALLERS.admin.oid,
    });
    // Links never grant access (Permission matrix, Identity links).
    expect(await affiliationOf(alice.oid)).toBeNull();
    expect(await scopesOf(alice.oid)).toEqual([]);
  });

  it("updates at the current version, bumping it; a key that leaves the link is released for another person", async () => {
    await expectData(await putLink(alice.oid, link(0)));
    const updated = await expectData<Link>(
      await putLink(
        alice.oid,
        link(1, { usageIdentities: ["alice@company.com"], aliases: [] }),
      ),
    );
    expect(updated).toMatchObject({ aliases: [], version: 2 });
    // "alice-sso" was released, so Bob can now claim it.
    await expectData(
      await putLink(
        bob.oid,
        link(0, {
          usageIdentities: ["bob@company.com"],
          aliases: ["alice-sso"],
        }),
      ),
    );
  });

  it("lower-cases usage identities (canonical usage identity)", async () => {
    const data = await expectData<Link>(
      await putLink(
        alice.oid,
        link(0, { usageIdentities: ["  Alice@Company.com "], aliases: [] }),
      ),
    );
    expect(data.usageIdentities).toEqual(["alice@company.com"]);
  });

  it("omits the LiteLLM id when none is given", async () => {
    const data = await expectData<Link>(
      await putLink(alice.oid, link(0, { litellmUserId: undefined })),
    );
    expect(data.litellmUserId).toBeUndefined();
  });

  it("accepts a body oid that equals the path oid", async () => {
    await expectData(await putLink(alice.oid, link(0, { oid: alice.oid })));
  });

  it("401 without a session", async () => {
    signInAs(null);
    await expectError(await putLink(alice.oid, link(0)), 401, "UNAUTHORIZED");
    expect(await getIdentityLink(alice.oid)).toBeNull();
  });

  describe.each(CANNOT_WRITE)("as %s (no write permission)", (caller) => {
    beforeEach(() => signInAs(caller));

    it("403 FORBIDDEN, nothing written, one denied record with the fixed route pattern", async () => {
      const before = await nonAuditItems();
      await expectError(await putLink(alice.oid, link(0)), 403, "FORBIDDEN");
      expect(await nonAuditItems()).toEqual(before);
      expect(await auditToday()).toHaveLength(1);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "identity.link.update",
        code: "FORBIDDEN",
        route: { method: "PUT", pattern: LINKS },
      });
    });

    it("403 comes before parsing and before any read: a malformed oid, body, content type and origin all stay 403", async () => {
      const longId = "x".repeat(200);
      for (const call of [
        { oid: alice.oid, body: "{not json" },
        { oid: alice.oid, body: {} },
        { oid: longId, body: link(0) },
        { oid: MISSING, body: link(0) },
        { oid: alice.oid, body: link(0), extra: { contentType: "text/plain" } },
        {
          oid: alice.oid,
          body: link(0),
          extra: { origin: "https://evil.example.test" },
        },
      ]) {
        await expectError(
          await putLink(call.oid, call.body, call.extra),
          403,
          "FORBIDDEN",
        );
      }
      await expectError(await putLink(longId, link(0)), 403, "FORBIDDEN");
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "identity.link.update",
        code: "FORBIDDEN",
        route: { method: "PUT", pattern: LINKS },
        forbiddenRaw: [longId],
      });
      expect(await getIdentityLink(alice.oid)).toBeNull();
    });
  });

  it("403 for an admin with a missing or foreign Origin, before parsing; nothing is stored", async () => {
    for (const origin of [null, "https://evil.example.test", "null"]) {
      await expectError(
        await putLink(alice.oid, link(0), { origin }),
        403,
        "FORBIDDEN",
      );
    }
    expect(await getIdentityLink(alice.oid)).toBeNull();
  });

  it("404 NOT_FOUND for an identity that does not exist; nothing is claimed and nothing is audited", async () => {
    const before = await nonAuditItems();
    await expectError(await putLink(MISSING, link(0)), 404, "NOT_FOUND");
    expect(await nonAuditItems()).toEqual(before);
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it("409 CONFLICT for a stale version and for version 0 when a link exists; the link is unchanged and nothing is audited", async () => {
    await expectData(await putLink(alice.oid, link(0)));
    const audited = (await auditToday()).length;
    for (const version of [0, 7]) {
      await expectError(
        await putLink(alice.oid, link(version, { aliases: ["other"] })),
        409,
        "CONFLICT",
      );
    }
    expect(await getIdentityLink(alice.oid)).toMatchObject({
      aliases: ["alice-sso"],
      version: 1,
    });
    expect((await auditToday()).length).toBe(audited);
    expect(await deniedToday()).toEqual([]);
  });

  it.each([
    [
      "an alias",
      { usageIdentities: ["bob@company.com"], aliases: ["alice-sso"] },
    ],
    [
      "a usage identity",
      { usageIdentities: ["alice@company.com"], aliases: [] },
    ],
    [
      "a usage identity differing only in case",
      { usageIdentities: ["Alice@Company.com"], aliases: [] },
    ],
  ])(
    "409 CONFLICT when %s already belongs to another person; nothing changes and nothing is audited",
    async (_n, over) => {
      await expectData(await putLink(alice.oid, link(0)));
      const audited = (await auditToday()).length;
      await expectError(
        await putLink(bob.oid, link(0, { ...over, litellmUserId: undefined })),
        409,
        "CONFLICT",
      );
      expect(await getIdentityLink(bob.oid)).toBeNull();
      expect((await auditToday()).length).toBe(audited);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it("an alias may also not equal another person's usage identity", async () => {
    await expectData(await putLink(alice.oid, link(0)));
    await expectError(
      await putLink(
        bob.oid,
        link(0, {
          usageIdentities: ["bob@company.com"],
          aliases: ["alice@company.com"],
        }),
      ),
      409,
      "CONFLICT",
    );
  });

  // T16 (per-user data before approval) and Identity links: a link must not
  // let its holder read another person's usage. 4R.4 review B2.
  describe("a key that is, or resolves to, another identity's canonical email (T16)", () => {
    it.each([
      [
        "an alias equal to another identity's email",
        { usageIdentities: [], aliases: ["bob@company.com"] },
      ],
      [
        "an alias equal to another identity's email, differing in case",
        { usageIdentities: [], aliases: ["Bob@Company.com"] },
      ],
      [
        "an alias whose session name is another identity's email",
        {
          usageIdentities: [],
          aliases: [
            "arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_X_y/bob@company.com",
          ],
        },
      ],
      [
        "a usage identity equal to another identity's email",
        { usageIdentities: ["bob@company.com"], aliases: [] },
      ],
    ])(
      "409 CONFLICT for %s; nothing is stored, claimed or audited",
      async (_n, over) => {
        const before = await nonAuditItems();
        await expectError(
          await putLink(
            alice.oid,
            link(0, { ...over, litellmUserId: undefined }),
          ),
          409,
          "CONFLICT",
        );
        expect(await getIdentityLink(alice.oid)).toBeNull();
        expect(await nonAuditItems()).toEqual(before);
        expect(await auditToday()).toEqual([]);
        expect(await deniedToday()).toEqual([]);
      },
    );

    // 4R.4 round 3 B2 (T16; Identity links): a link holds at most the
    // person's OWN canonical email as a person-kind key, owned elsewhere or not.
    it("a usage identity equal to the person's own email is accepted (the one person-kind key allowed)", async () => {
      const data = await expectData<Link>(
        await putLink(
          alice.oid,
          link(0, { aliases: [], litellmUserId: undefined }),
        ),
      );
      expect(data.usageIdentities).toEqual(["alice@company.com"]);
    });

    it("the own email is normalised (case, whitespace) and stored once", async () => {
      const data = await expectData<Link>(
        await putLink(
          alice.oid,
          link(0, {
            usageIdentities: ["  Alice@Company.com "],
            aliases: [],
            litellmUserId: undefined,
          }),
        ),
      );
      expect(data.usageIdentities).toEqual(["alice@company.com"]);
    });

    it.each([
      [
        "an unowned email as a usage identity",
        { usageIdentities: ["bobby@elsewhere.example"], aliases: [] },
      ],
      [
        "an unowned email, mixed case and padded",
        { usageIdentities: ["  Bobby@Elsewhere.Example "], aliases: [] },
      ],
      [
        "an unowned email as an alias",
        { usageIdentities: [], aliases: ["bobby@elsewhere.example"] },
      ],
      [
        "an ARN whose session name is an unowned email, as a usage identity",
        {
          usageIdentities: [
            "arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_X_y/bobby@elsewhere.example",
          ],
          aliases: [],
        },
      ],
      [
        "an ARN whose session name is an unowned email, as an alias",
        {
          usageIdentities: [],
          aliases: [
            "arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_X_y/Bobby@Elsewhere.Example",
          ],
        },
      ],
      [
        "an owned other email next to the own email",
        {
          usageIdentities: ["alice@company.com", "bob@company.com"],
          aliases: [],
        },
      ],
    ])(
      "409 CONFLICT for %s; nothing is stored, claimed or audited",
      async (_n, over) => {
        const before = await nonAuditItems();
        await expectError(
          await putLink(
            alice.oid,
            link(0, { ...over, litellmUserId: undefined }),
          ),
          409,
          "CONFLICT",
        );
        expect(await getIdentityLink(alice.oid)).toBeNull();
        expect(await nonAuditItems()).toEqual(before);
        expect(await auditToday()).toEqual([]);
        expect(await deniedToday()).toEqual([]);
      },
    );

    it("non-person keys (an ARN without an email session name, a plain name) are accepted", async () => {
      const data = await expectData<Link>(
        await putLink(
          alice.oid,
          link(0, {
            usageIdentities: [
              "alice@company.com",
              "arn:aws:iam::000000000000:role/svc-bot",
            ],
            aliases: ["svc-name"],
            litellmUserId: undefined,
          }),
        ),
      );
      expect(data.usageIdentities).toContain(
        "arn:aws:iam::000000000000:role/svc-bot",
      );
      expect(data.aliases).toEqual(["svc-name"]);
    });
  });

  // Access Control spec - "Identity links" / D27: an alias is the exact raw key
  // of a non-person usage identity (D35). 4R.4 round 3 B2: a person-kind alias
  // other than the own email is a 409 (T16), like a usage identity.
  describe("person-kind aliases (D27, T16)", () => {
    it.each([
      ["an email no identity owns", "stranger@elsewhere.example"],
      [
        "an ARN whose session name is an email",
        "arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_X_y/stranger@elsewhere.example",
      ],
    ])(
      "409 CONFLICT for an alias that is %s; nothing is stored or audited",
      async (_n, alias) => {
        await expectError(
          await putLink(
            alice.oid,
            link(0, {
              usageIdentities: ["alice@company.com"],
              aliases: [alias],
              litellmUserId: undefined,
            }),
          ),
          409,
          "CONFLICT",
        );
        expect(await getIdentityLink(alice.oid)).toBeNull();
        expect(await auditToday()).toEqual([]);
        expect(await deniedToday()).toEqual([]);
      },
    );

    it("the own email as an alias is not accepted: it belongs in usageIdentities (D27)", async () => {
      const res = await putLink(
        alice.oid,
        link(0, {
          usageIdentities: [],
          aliases: ["alice@company.com"],
          litellmUserId: undefined,
        }),
      );
      expect(res.status).toBe(409);
      expect(await getIdentityLink(alice.oid)).toBeNull();
      expect(await auditToday()).toEqual([]);
    });

    it("accepts a non-person alias such as an SSO role session name", async () => {
      const data = await expectData<Link>(
        await putLink(
          alice.oid,
          link(0, {
            usageIdentities: ["alice@company.com"],
            aliases: ["alice-sso"],
          }),
        ),
      );
      expect(data.aliases).toEqual(["alice-sso"]);
    });
  });

  // 4R.4 round 3 W: one effective-roles rule (claim + in-app grants) for
  // requireAdmin, loadWriteActor and resolveScope - Access Control spec, Roles
  // and Enforcement item 4. A dev-login (local) session holding an
  // internal-admin grant is admin on a requireAdmin route.
  it("a dev-login (local) session holding an in-app internal-admin grant passes requireAdmin, as resolveScope sees it", async () => {
    const localOid = CALLERS.viewerNone.oid;
    ok(
      await grantRole(
        { oid: localOid, role: "internal-admin", reason: "dev cover" },
        seedCtx(),
      ),
    );
    vi.mocked(auth).mockResolvedValue({
      user: {
        oid: localOid,
        email: "v0@company.com",
        roles: ["internal-viewer"],
        tid: "local",
        authMethod: "local",
      },
    } as never);
    await expectData(await putLink(alice.oid, link(0)));
  });

  it.each([
    ["no Content-Type", null],
    ["text/plain", "text/plain"],
  ])(
    "400 BAD_REQUEST for %s; nothing stored or audited",
    async (_n, contentType) => {
      await expectError(
        await putLink(alice.oid, link(0), { contentType }),
        400,
        "BAD_REQUEST",
      );
      expect(await getIdentityLink(alice.oid)).toBeNull();
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it.each([
    ["invalid JSON", "{not json"],
    ["an empty object", {}],
    ["a non-object body", "[]"],
    ["a missing version", link(0, { version: undefined })],
    ["a negative version", link(-1)],
    ["a non-integer version", link(0, { version: 0.5 })],
    [
      "usageIdentities that is not an array",
      link(0, { usageIdentities: "a@b.com" }),
    ],
    ["aliases that is not an array", link(0, { aliases: "x" })],
    ["a missing aliases list", link(0, { aliases: undefined })],
    ["an empty alias", link(0, { aliases: [""] })],
    ["an alias over 254 characters", link(0, { aliases: ["a".repeat(255)] })],
    [
      "the same key twice in one request (usage identity and alias)",
      link(0, {
        usageIdentities: ["dup@company.com"],
        aliases: ["dup@company.com"],
      }),
    ],
    ["an empty litellmUserId", link(0, { litellmUserId: "" })],
    ["a body oid that differs from the path", link(0, { oid: bob.oid })],
  ])(
    "400 BAD_REQUEST for %s; nothing stored, no record, no denied record",
    async (_n, body) => {
      await expectError(await putLink(alice.oid, body), 400, "BAD_REQUEST");
      expect(await getIdentityLink(alice.oid)).toBeNull();
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it("400 BAD_REQUEST for a malformed path oid (an admin)", async () => {
    await expectError(
      await putLink("x".repeat(129), link(0)),
      400,
      "BAD_REQUEST",
    );
  });
});
