import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetDeniedAudit } from "@/lib/data/access/audit";
import {
  IDENTITY_MAP_RULES_SK,
  getIdentityMapRules,
  setIdentityMapRules,
} from "@/lib/data/access/identity-map-rules";
import { putIdentityLink } from "@/lib/data/access/identity-links";
import {
  auditToday,
  deniedToday,
  expectData,
  expectError,
  invoke,
  nonAuditItems,
  signInAs,
} from "@/test/governance-route-support";
import { PEOPLE, seedCtx, seedIdentity } from "@/test/matrix-route-support";
import { ok } from "@/lib/data/access/access-test-support";
import { buildRollup } from "@/test/rollup-builder";
import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/test-support";

import {
  GET as getRules,
  PUT as putRules,
} from "./governance/identity-map-rules/route";
import { GET as getSuggestions } from "./governance/identity-map-rules/suggestions/route";
import { PUT as putLink } from "./identities/[oid]/links/route";

// Source: docs/specs/2026-11-10-access-control.md - "Usage-identity mapping
// rules (D27)" (an internal-admin defines rules in Settings, stored in one
// GOVERNANCE/IDENTITY_MAP_RULES item, versioned and audited; the Identity links
// section SUGGESTS a link for each non-person usage key that a rule maps to an
// existing identity's email; the admin confirms each suggestion as an exact
// alias with its UsageKeyClaim; rules never grant access and never map to a
// person automatically), "Roles" and "Permission matrix" (configuration and
// identity links are internal-admin only; the auditor reads), "Enforcement"
// items 2 (403 before parsing), 4 (no-store, authorization data uncached), 6
// (Zod, version -> 409, same-origin, JSON content type), "Audit log" (one
// success record in the transaction; 400 and 409 write none; one `denied`
// record per authorization refusal with a fixed route pattern; read refusals are
// metric-only, D17/T22), Data Model - DateRangeQuerySchema (90-day cap).
//
// SPEC GAP: "API routes (additions)" lists no route for mapping rules. Derived
// from D27 and the sibling governance routes:
//   GET/PUT /api/governance/identity-map-rules       (GET admin|auditor; PUT admin)
//   GET     /api/governance/identity-map-rules/suggestions?dateFrom&dateTo
//           (admin|auditor; non-person byUser keys of the range's rollups)
// Confirming a suggestion reuses PUT /api/identities/[oid]/links (the alias and
// its claim; 409 on a duplicate); there is no confirm route. Only `@/auth` is
// mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const RULES = "/api/governance/identity-map-rules";
const SUGGESTIONS = `${RULES}/suggestions`;
const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-03";
const NOW = new Date("2026-11-15T09:30:00.000Z");
const SSO = { pattern: "{name}-sso", template: "{name}@company.com" };
const SVC = { pattern: "svc-{name}", template: "{name}@company.com" };

const get = () => invoke(getRules, { method: "GET", path: RULES });
const put = (body: unknown, extra = {}) =>
  invoke(putRules, { method: "PUT", path: RULES, body, ...extra });

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  signInAs("admin");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("GET /api/governance/identity-map-rules", () => {
  it("returns the empty list at version 0 when nothing is stored (not an error, not an updatedAt)", async () => {
    const data = await expectData<Record<string, unknown>>(await get());
    expect(data).toEqual({ rules: [], version: 0 });
  });

  it.each(["admin", "auditor"] as const)(
    "%s reads the stored rules in order with version and updatedAt",
    async (caller) => {
      await expectData(await put({ rules: [SSO, SVC], version: 0 }));
      signInAs(caller);
      expect(await expectData(await get())).toEqual({
        rules: [SSO, SVC],
        version: 1,
        updatedAt: NOW.toISOString(),
      });
    },
  );

  it("reads are not audited and write nothing", async () => {
    await expectData(await get());
    expect(await auditToday()).toEqual([]);
    expect(await nonAuditItems()).toEqual([]);
  });

  it.each(["orgAdmin", "viewer", "noRoles"] as const)(
    "403 FORBIDDEN for %s with no rules in the body; a read refusal writes no denied record",
    async (caller) => {
      await expectData(await put({ rules: [SSO], version: 0 }));
      signInAs(caller);
      const audit0 = (await auditToday()).length;
      const body = await expectError(await get(), 403, "FORBIDDEN");
      expect(JSON.stringify(body)).not.toContain("sso");
      expect(await auditToday()).toHaveLength(audit0);
      expect(await deniedToday()).toEqual([]);
    },
  );
});

describe("PUT /api/governance/identity-map-rules", () => {
  it("creates the rules: version 1, updatedAt = now, returned in the GET shape, stored in the one governance item", async () => {
    const data = await expectData(await put({ rules: [SSO, SVC], version: 0 }));
    expect(data).toEqual({
      rules: [SSO, SVC],
      version: 1,
      updatedAt: NOW.toISOString(),
    });
    expect(await getIdentityMapRules()).toEqual(data);
    const items = await nonAuditItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      PK: "GOVERNANCE",
      SK: IDENTITY_MAP_RULES_SK,
    });
  });

  it("writes exactly one identity.map.update success record naming the session actor", async () => {
    await expectData(await put({ rules: [SSO], version: 0 }));
    const records = await auditToday();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "identity.map.update",
      category: "change",
      result: "success",
      actor: "oid-admin",
    });
  });

  it("add, edit, reorder and delete are the same write: the list is replaced at the current version", async () => {
    await expectData(await put({ rules: [SSO], version: 0 }));
    expect(
      await expectData(await put({ rules: [SVC, SSO], version: 1 })),
    ).toMatchObject({ rules: [SVC, SSO], version: 2 });
    const edited = { ...SSO, template: "{name}@other.example" };
    expect(
      await expectData(await put({ rules: [SVC, edited], version: 2 })),
    ).toMatchObject({ rules: [SVC, edited], version: 3 });
    expect(
      await expectData(await put({ rules: [], version: 3 })),
    ).toMatchObject({ rules: [], version: 4 });
    expect(await auditToday()).toHaveLength(4);
  });

  it("writes nothing but the rules item: no link, claim, affiliation or scope appears", async () => {
    await seedIdentity(PEOPLE.alice.oid, { email: PEOPLE.alice.email });
    const before = await nonAuditItems();
    await expectData(await put({ rules: [SSO], version: 0 }));
    const after = await nonAuditItems();
    expect(after).toHaveLength(before.length + 1);
    expect(
      after.filter((i) => !before.some((b) => b.PK === i.PK && b.SK === i.SK)),
    ).toMatchObject([{ PK: "GOVERNANCE", SK: IDENTITY_MAP_RULES_SK }]);
  });

  it("409 CONFLICT for a stale or premature version; state unchanged, no audit record, no denied record", async () => {
    await expectData(await put({ rules: [SSO], version: 0 }));
    const audit0 = (await auditToday()).length;
    for (const version of [0, 2, 9]) {
      await expectError(await put({ rules: [SVC], version }), 409, "CONFLICT");
    }
    expect(await getIdentityMapRules()).toMatchObject({
      rules: [SSO],
      version: 1,
    });
    expect(await auditToday()).toHaveLength(audit0);
    expect(await deniedToday()).toEqual([]);
  });

  it("409 CONFLICT for a non-zero version when nothing is stored", async () => {
    await expectError(await put({ rules: [SSO], version: 2 }), 409, "CONFLICT");
    expect(await getIdentityMapRules()).toBeNull();
    expect(await auditToday()).toEqual([]);
  });

  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      pattern: `p${i}-{name}`,
      template: "{name}@company.com",
    }));

  it.each([
    ["no Content-Type", { contentType: null, body: { rules: [], version: 0 } }],
    [
      "text/plain",
      { contentType: "text/plain", body: { rules: [], version: 0 } },
    ],
    ["invalid JSON", { body: "{not json" }],
    ["an empty object", { body: {} }],
    ["a non-object body", { body: "[]" }],
    ["a missing rules list", { body: { version: 0 } }],
    ["rules that is not a list", { body: { rules: SSO, version: 0 } }],
    ["a missing version", { body: { rules: [SSO] } }],
    ["a string version", { body: { rules: [SSO], version: "0" } }],
    ["a fractional version", { body: { rules: [SSO], version: 0.5 } }],
    ["a negative version", { body: { rules: [SSO], version: -1 } }],
    [
      "a pattern without the placeholder",
      { body: { rules: [{ ...SSO, pattern: "jane-sso" }], version: 0 } },
    ],
    [
      "a pattern with two placeholders",
      { body: { rules: [{ ...SSO, pattern: "{name}-{name}" }], version: 0 } },
    ],
    [
      "a template that is not an email",
      { body: { rules: [{ ...SSO, template: "{name}" }], version: 0 } },
    ],
    [
      "a template without the placeholder",
      { body: { rules: [{ ...SSO, template: "x@company.com" }], version: 0 } },
    ],
    [
      "a rule missing its template",
      { body: { rules: [{ pattern: "{name}-sso" }], version: 0 } },
    ],
    [
      "a duplicate pattern",
      {
        body: {
          rules: [SSO, { ...SSO, template: "{name}@b.example" }],
          version: 0,
        },
      },
    ],
    ["21 rules", { body: { rules: many(21), version: 0 } }],
  ])(
    "400 BAD_REQUEST for %s; nothing stored, no audit record of any kind",
    async (_name, call) => {
      await expectError(
        await invoke(putRules, { method: "PUT", path: RULES, ...call }),
        400,
        "BAD_REQUEST",
      );
      expect(await nonAuditItems()).toEqual([]);
      expect(await auditToday()).toEqual([]);
    },
  );

  it("accepts exactly 20 rules", async () => {
    await expectData(await put({ rules: many(20), version: 0 }));
  });

  it("leaves previously stored rules untouched on a 400", async () => {
    await expectData(await put({ rules: [SSO], version: 0 }));
    await expectError(
      await put({ rules: [{ pattern: "bad", template: "x" }], version: 1 }),
      400,
      "BAD_REQUEST",
    );
    expect(await getIdentityMapRules()).toMatchObject({
      rules: [SSO],
      version: 1,
    });
  });
});

describe("GET /api/governance/identity-map-rules/suggestions", () => {
  const sug = (query = RANGE) =>
    invoke(getSuggestions, { method: "GET", path: `${SUGGESTIONS}?${query}` });

  async function seedWorld(options: {
    keys: string[];
    date?: string;
    rules?: { pattern: string; template: string }[];
  }) {
    for (const p of Object.values(PEOPLE)) {
      await seedIdentity(p.oid, { email: p.email, name: p.name });
    }
    if (options.rules !== undefined && options.rules.length > 0) {
      ok(
        await setIdentityMapRules(
          { rules: options.rules, version: 0 },
          seedCtx(),
        ),
      );
    }
    await loadFixtures({
      accounts: [makeAccount(1)],
      rollups: [
        buildRollup({
          date: options.date ?? "2026-10-02",
          models: {
            "claude-sonnet": {
              cost: 10,
              byUser: Object.fromEntries(options.keys.map((k) => [k, 1])),
            },
          },
        }),
      ],
    });
  }

  const alice = {
    pattern: "{name}-sso",
    usageKey: "alice-sso",
    email: "alice@company.com",
    oid: PEOPLE.alice.oid,
  };

  it("suggests only non-person usage keys that a rule maps to an existing identity's email", async () => {
    await seedWorld({
      rules: [SSO],
      keys: [
        "alice-sso",
        "zed-sso",
        "carol-svc",
        "bob@company.com",
        "Dave-SSO",
      ],
    });
    const data = await expectData<{ items: unknown[] }>(await sug());
    expect(data.items).toEqual([
      alice,
      {
        pattern: "{name}-sso",
        usageKey: "dave-sso",
        email: "dave@company.com",
        oid: PEOPLE.dave.oid,
      },
    ]);
  });

  it("a suggestion carries only pattern, usageKey, email and oid: no lockout state, tenant or roles", async () => {
    await seedWorld({ rules: [SSO], keys: ["alice-sso"] });
    const { items } = await expectData<{ items: Record<string, unknown>[] }>(
      await sug(),
    );
    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      "email",
      "oid",
      "pattern",
      "usageKey",
    ]);
    expect(JSON.stringify(items)).not.toMatch(/failedAttempts|lockedUntil|tid/);
  });

  it("matches the identity email case-insensitively", async () => {
    await seedWorld({ rules: [SSO], keys: ["carol-sso"] });
    await seedIdentity(PEOPLE.carol.oid, { email: "Carol@Company.COM" });
    const { items } = await expectData<{ items: { oid: string }[] }>(
      await sug(),
    );
    expect(items.map((i) => i.oid)).toEqual([PEOPLE.carol.oid]);
  });

  it("suggests nothing when two identities share the mapped email", async () => {
    await seedWorld({ rules: [SSO], keys: ["alice-sso"] });
    await seedIdentity("oid-alice-twin", { email: PEOPLE.alice.email });
    expect(await expectData(await sug())).toEqual({ items: [] });
  });

  it("suggests nothing without rules, even for keys that look mappable", async () => {
    await seedWorld({ keys: ["alice-sso"] });
    expect(await expectData(await sug())).toEqual({ items: [] });
  });

  it("lists a key once however many days and accounts report it", async () => {
    await seedWorld({ rules: [SSO], keys: ["alice-sso"] });
    await loadFixtures({
      accounts: [makeAccount(2)],
      rollups: [
        buildRollup({
          date: "2026-10-01",
          accountId: makeAccount(2).accountId,
          models: { "claude-sonnet": { cost: 5, byUser: { "alice-sso": 1 } } },
        }),
        buildRollup({
          date: "2026-10-03",
          models: { "claude-sonnet": { cost: 5, byUser: { "Alice-SSO": 1 } } },
        }),
      ],
    });
    const { items } = await expectData<{ items: unknown[] }>(await sug());
    expect(items).toEqual([alice]);
  });

  it("considers only the requested range", async () => {
    await seedWorld({ rules: [SSO], keys: ["alice-sso"], date: "2026-09-01" });
    expect(await expectData(await sug())).toEqual({ items: [] });
    expect(
      await expectData(await sug("dateFrom=2026-09-01&dateTo=2026-09-01")),
    ).toEqual({ items: [alice] });
  });

  it("omits a key that is already claimed, by the same person or by anyone else (a confirm would be a 409)", async () => {
    await seedWorld({
      rules: [SSO],
      keys: ["alice-sso", "bob-sso", "dave-sso"],
    });
    ok(
      await putIdentityLink(
        {
          oid: PEOPLE.carol.oid,
          usageIdentities: [],
          aliases: ["alice-sso"],
          version: null,
        },
        seedCtx(),
      ),
    );
    ok(
      await putIdentityLink(
        {
          oid: PEOPLE.dave.oid,
          usageIdentities: [],
          aliases: ["dave-sso"],
          version: null,
        },
        seedCtx(),
      ),
    );
    const { items } = await expectData<{ items: { usageKey: string }[] }>(
      await sug(),
    );
    expect(items.map((i) => i.usageKey)).toEqual(["bob-sso"]);
  });

  it("is read-only: it never links anyone, claims a key, grants access or writes an audit record", async () => {
    await seedWorld({ rules: [SSO], keys: ["alice-sso", "bob-sso"] });
    const before = await nonAuditItems();
    const audit0 = (await auditToday()).length;
    await expectData(await sug());
    expect(await nonAuditItems()).toEqual(before);
    expect(await auditToday()).toHaveLength(audit0);
    expect(
      before.filter((i) => /^(USAGEKEY#|MEMBERS#|ADMINS#)/.test(String(i.PK))),
    ).toEqual([]);
  });

  it("confirming a suggestion through the existing link route stores the exact alias and its claim, and the suggestion disappears", async () => {
    await seedWorld({ rules: [SSO], keys: ["alice-sso", "bob-sso"] });
    const { items } = await expectData<{ items: (typeof alice)[] }>(
      await sug(),
    );
    expect(items.map((i) => i.usageKey)).toEqual(["alice-sso", "bob-sso"]);

    const res = await invoke(putLink, {
      method: "PUT",
      path: `/api/identities/${alice.oid}/links`,
      params: { oid: alice.oid },
      body: {
        usageIdentities: [],
        aliases: [alice.usageKey],
        version: 0,
      },
    });
    expect(await expectData(res)).toMatchObject({
      oid: alice.oid,
      aliases: ["alice-sso"],
      version: 1,
    });
    const after = await expectData<{ items: { usageKey: string }[] }>(
      await sug(),
    );
    expect(after.items.map((i) => i.usageKey)).toEqual(["bob-sso"]);
  });

  it("the auditor may read the suggestions", async () => {
    await seedWorld({ rules: [SSO], keys: ["alice-sso"] });
    signInAs("auditor");
    expect(await expectData(await sug())).toEqual({ items: [alice] });
  });

  it.each(["orgAdmin", "viewer", "noRoles"] as const)(
    "403 FORBIDDEN for %s with no usage keys, emails or ids in the body; no denied record (read refusal)",
    async (caller) => {
      await seedWorld({ rules: [SSO], keys: ["alice-sso"] });
      signInAs(caller);
      const body = await expectError(await sug(), 403, "FORBIDDEN");
      expect(JSON.stringify(body)).not.toMatch(/alice/);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it.each([
    ["a missing dateFrom", "dateTo=2026-10-03"],
    ["a missing dateTo", "dateFrom=2026-10-01"],
    ["no range at all", ""],
    ["a malformed date", "dateFrom=2026-13-01&dateTo=2026-10-03"],
    ["a reversed range", "dateFrom=2026-10-03&dateTo=2026-10-01"],
    ["a range over 90 days", "dateFrom=2026-01-01&dateTo=2026-04-01"],
  ])("400 BAD_REQUEST for %s", async (_name, query) => {
    await expectError(await sug(query), 400, "BAD_REQUEST");
  });

  it("accepts a range of exactly 90 days", async () => {
    await expectData(await sug("dateFrom=2026-08-18&dateTo=2026-11-15"));
  });
});
