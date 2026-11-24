import { describe, expect, it, vi } from "vitest";

import {
  getIdentityLink,
  getLiteLLMUserOwner,
  putIdentityLink,
  writeLiteLLMUserLink,
} from "@/lib/data/access/identity-links";
import { TEAM_LEAD_OID } from "@/lib/auth/team-lead-identity";
import { call, signInWithRoles } from "@/test/fakes/fake-litellm-views";
import {
  AUDIT_DAY,
  PEOPLE,
  expectError,
  installMemberWritesFake,
  setupMemberWritesSuite,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/support/litellm-member-writes-support";
import { seedIdentity } from "@/test/support/matrix-route-support";
import { signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { putRaw } from "@/test/support/test-support";
import { addMember } from "@/lib/data/access/affiliations";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (`GET /api/identities/directory`: internal-admin, internal-org-admin and
// internal-auditor read; 25 rows a page with an opaque cursor; `?include=
// litellmMatch` adds a read-only `match`), "LiteLLM user links" (nothing is
// linked automatically, D27; usage identities and aliases stay out of the
// directory, they are admin-only data), T-MI1, Rule 60.10 (identity links are
// never cached). The 401, no-store and 400 shape belong to the shared
// route-contract suite (registry entry in test/route-registry.ts, Rule 60.23).
// LiteLLM is the in-process fake (Rule 60.24).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupMemberWritesSuite();
const alice = PEOPLE.alice;
const bob = PEOPLE.bob;

type Row = {
  oid: string;
  email: string | null;
  memberTeamId: string | null;
  litellm: { state: string; litellmUserId?: string };
  linkVersion: number;
  createdAt?: string;
  lastSignInAt?: string | null;
  match?: { litellmUserId: string; email: string } | null;
};

async function list(query = "") {
  stubLiteLLMEnv();
  const { GET } = await import("./route");
  return call(GET, `/api/identities/directory${query}`);
}
const rows = (body: { data?: unknown }) =>
  (body.data as { items: Row[]; cursor?: string }).items;
const rowOf = (items: Row[], oid: string) => items.find((r) => r.oid === oid);
const oidN = (n: number) =>
  `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;

async function seedMany(n: number) {
  for (let i = 0; i < n; i++) {
    await seedIdentity(oidN(i), { email: `p${i}@company.com`, name: `P${i}` });
  }
}

describe("GET /api/identities/directory", () => {
  describe("who may read (API routes: admin, org-admin, auditor)", () => {
    it.each(["admin", "orgAdmin", "auditor"] as CallerName[])(
      "%s gets 200",
      async (who) => {
        signInAs(who);
        const { res, body } = await list();
        expect(res.status).toBe(200);
        expect(rows(body).length).toBeGreaterThan(0);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
      },
    );

    it.each([
      "teamAdminA",
      "deptAdminEng",
      "memberA",
      "viewerNone",
      "noRole",
    ] as const)("%s gets 403 and no row is read from LiteLLM", async (who) => {
      if (who === "noRole") await signInWithRoles([]);
      else signInAs(who);
      const { res } = await list("?include=litellmMatch");
      await expectError(res, 403, "FORBIDDEN");
      expect(state.fake.calls).toHaveLength(0);
    });
  });

  describe("paging (25 a page, opaque cursor)", () => {
    it("serves 25 rows a page and walks every identity exactly once through the cursor", async () => {
      await seedMany(30);
      signInAs("admin");
      const first = await list();
      expect(rows(first.body)).toHaveLength(25);
      const cursor = (first.body.data as { cursor?: string }).cursor;
      expect(typeof cursor).toBe("string");
      expect(cursor).not.toContain(rows(first.body)[0]?.oid ?? "x");

      const second = await list(`?cursor=${encodeURIComponent(cursor ?? "")}`);
      expect(second.res.status).toBe(200);
      expect(rows(second.body)).toHaveLength(10); // 30 + 4 people + the seeded team lead - 25
      expect((second.body.data as { cursor?: string }).cursor).toBeUndefined();

      const all = [...rows(first.body), ...rows(second.body)].map((r) => r.oid);
      expect(new Set(all).size).toBe(35);
    });

    it("400 for a cursor that was not issued by the server", async () => {
      signInAs("admin");
      const { res } = await list("?cursor=not-a-cursor");
      await expectError(res, 400, "BAD_REQUEST");
    });

    it("400 for an unknown include value", async () => {
      signInAs("admin");
      const { res } = await list("?include=everything");
      await expectError(res, 400, "BAD_REQUEST");
    });
  });

  describe("rows (no usage identities, aliases or sign-in state)", () => {
    it("shows link state and version, and never the usage identities or aliases of the link", async () => {
      ok(
        await putIdentityLink(
          {
            oid: alice.oid,
            usageIdentities: ["secret.usage@example.com"],
            aliases: ["secret-alias"],
            litellmUserId: "lu-alice",
            version: null,
          },
          ctxAt(undefined, "req-seed-link"),
        ),
      );
      signInAs("auditor");
      const { body, text } = await list();
      const items = rows(body);
      expect(rowOf(items, alice.oid)).toMatchObject({
        email: alice.email,
        memberTeamId: "team-a",
        litellm: { state: "linked", litellmUserId: "lu-alice" },
        linkVersion: 1,
      });
      expect(rowOf(items, PEOPLE.carol.oid)).toMatchObject({
        litellm: { state: "none" },
        linkVersion: 0,
        memberTeamId: null,
      });
      for (const leak of [
        "secret.usage@example.com",
        "secret-alias",
        "usageIdentities",
        "aliases",
        "failedAttempts",
        "lockedUntil",
        "lastSeenRoles",
      ]) {
        expect(text, leak).not.toContain(leak);
      }
      for (const row of items) {
        expect(Object.keys(row).sort()).toEqual(
          [
            "authMethod",
            "displayName",
            "email",
            "linkVersion",
            "lastSignInAt",
            "litellm",
            "memberTeamId",
            "oid",
          ].sort(),
        );
      }
    });

    it("never reads LiteLLM and has no match field without include", async () => {
      signInAs("admin");
      const { body } = await list();
      expect(state.fake.calls).toHaveLength(0);
      for (const row of rows(body)) expect(row).not.toHaveProperty("match");
    });
  });

  describe("include=litellmMatch (a suggestion only; nothing is linked automatically, D27)", () => {
    it("adds match to unlinked rows from the LiteLLM user with the same email, null when none", async () => {
      signInAs("admin");
      const { body } = await list("?include=litellmMatch");
      const items = rows(body);
      expect(rowOf(items, bob.oid)?.match).toEqual({
        litellmUserId: bob.email,
        email: bob.email,
      });
      expect(rowOf(items, alice.oid)?.match).toBeNull();
    });

    it("a local identity whose address is not a real email (the seeded team lead) gets match null, not a 500 (D16, Dev login)", async () => {
      signInAs("admin");
      const { res, body } = await list("?include=litellmMatch");
      expect(res.status).toBe(200);
      expect(rowOf(rows(body), TEAM_LEAD_OID)?.match).toBeNull();
    });

    it("writes nothing: no link, no claim, no audit record, no LiteLLM write", async () => {
      signInAs("admin");
      const { res } = await list("?include=litellmMatch");
      expect(res.status).toBe(200);
      expect(await getIdentityLink(bob.oid)).toBeNull();
      expect(await getLiteLLMUserOwner(bob.email)).toBeNull();
      const { listAuditRecords } = await import("@/lib/data/access/audit");
      const links = (await listAuditRecords(AUDIT_DAY)).filter((r) =>
        r.action.startsWith("identity.litellm-link"),
      );
      expect(links).toHaveLength(0);
      expect(writeCalls(state)).toHaveLength(0);
    });

    it("looks up unlinked rows only: a linked identity gets no match and no lookup", async () => {
      ok(
        await putIdentityLink(
          {
            oid: bob.oid,
            usageIdentities: [],
            aliases: [],
            litellmUserId: "lu-bob",
            version: null,
          },
          ctxAt(undefined, "req-seed-link"),
        ),
      );
      signInAs("admin");
      const { body } = await list("?include=litellmMatch");
      expect(rowOf(rows(body), bob.oid)).not.toHaveProperty("match");
      expect(
        state.fake.calls.filter((c) =>
          c.url.includes(encodeURIComponent(bob.email)),
        ),
      ).toHaveLength(0);
    });

    it("503 LITELLM_UNAVAILABLE when LiteLLM is down, while the plain directory still answers", async () => {
      installMemberWritesFake(state, { outage: true });
      signInAs("admin");
      const withMatch = await list("?include=litellmMatch");
      await expectError(withMatch.res, 503, "LITELLM_UNAVAILABLE");
      expect((await list()).res.status).toBe(200);
    });
  });

  // Source: docs/specs/2026-11-10-access-control.md - row
  // /api/identities/directory, "From 2026-11-24 (unit US1, D-US3, D-US3a)":
  // `sort` (name, email, createdAt, lastSignInAt, team; default name) and `dir`
  // (asc, desc; default asc), anything else 400; in-memory sort with a stable
  // tie-break on oid; a row without the sort value sorts last in both
  // directions; the cursor encodes sort and dir (another one is 400); rows carry
  // createdAt (when present) and lastSignInAt; `q` takes no sort; lead 403.
  describe("sort and dir (unit US1, D-US3, D-US3a)", () => {
    const sid = (n: number) =>
      `00000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`;
    type Seed = {
      n: number;
      name: string;
      email: string;
      createdAt?: string;
      lastSignInAt: string;
    };
    // n=5 has no createdAt (a record written before unit US2). n=3 and n=4
    // tie on every sort value.
    const SEEDS: Seed[] = [
      {
        n: 1,
        name: "Bea",
        email: "d@s.com",
        createdAt: "2026-03-01T00:00:00.000Z",
        lastSignInAt: "2026-06-01T00:00:00.000Z",
      },
      {
        n: 2,
        name: "Abe",
        email: "e@s.com",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSignInAt: "2026-09-01T00:00:00.000Z",
      },
      {
        n: 3,
        name: "Cy",
        email: "a@s.com",
        createdAt: "2026-02-01T00:00:00.000Z",
        lastSignInAt: "2026-03-01T00:00:00.000Z",
      },
      {
        n: 4,
        name: "Cy",
        email: "a@s.com",
        createdAt: "2026-02-01T00:00:00.000Z",
        lastSignInAt: "2026-03-01T00:00:00.000Z",
      },
      {
        n: 5,
        name: "Dee",
        email: "c@s.com",
        lastSignInAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const mine = new Set(SEEDS.map((s) => sid(s.n)));

    async function seedSorted() {
      for (const s of SEEDS) {
        await putRaw({
          PK: `IDENT#${sid(s.n)}`,
          SK: "META",
          gsi1pk: "IDENTS",
          gsi1sk: `IDENT#${sid(s.n)}`,
          oid: sid(s.n),
          tid: "00000000-0000-4000-8000-0000000000ff",
          email: s.email,
          displayName: s.name,
          ...(s.createdAt ? { createdAt: s.createdAt } : {}),
          lastSignInAt: s.lastSignInAt,
          lastSeenRoles: ["internal-viewer"],
          authMethod: "entra",
          version: 1,
        });
      }
    }

    async function walk(query: string) {
      const all: Row[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const sep = query ? "&" : "?";
        const url = cursor
          ? `${query}${sep}cursor=${encodeURIComponent(cursor)}`
          : query;
        const { res, body } = await list(url);
        expect(res.status).toBe(200);
        all.push(...rows(body));
        cursor = (body.data as { cursor?: string }).cursor;
        if (!cursor) return all;
      }
      throw new Error("cursor never ended");
    }
    const mineOf = (items: Row[]) =>
      items.filter((r) => mine.has(r.oid)).map((r) => Number(r.oid.slice(-2)));

    it("defaults to name ascending when sort and dir are absent", async () => {
      await seedSorted();
      signInAs("admin");
      const names = (await walk("")).map((r) => r.oid);
      const explicit = (await walk("?sort=name&dir=asc")).map((r) => r.oid);
      expect(names).toEqual(explicit);
    });

    // [sort, dir, expected order of seeds 1-4 (ties 3,4 by oid asc), then 5]
    it.each([
      ["name", "asc", [2, 1, 3, 4, 5]],
      ["name", "desc", [5, 3, 4, 1, 2]],
      ["email", "asc", [3, 4, 5, 1, 2]],
      ["email", "desc", [2, 1, 5, 3, 4]],
      ["createdAt", "asc", [2, 3, 4, 1, 5]],
      ["createdAt", "desc", [1, 3, 4, 2, 5]],
      ["lastSignInAt", "asc", [3, 4, 5, 1, 2]],
      ["lastSignInAt", "desc", [2, 1, 5, 3, 4]],
    ] as const)(
      "sort=%s dir=%s orders the rows, ties together",
      async (sort, dir, expected) => {
        await seedSorted();
        signInAs("admin");
        const got = mineOf(await walk(`?sort=${sort}&dir=${dir}`));
        // Tied seeds (3 and 4) stay adjacent in either direction; the tie-break
        // on oid is ascending (stable).
        expect(got).toEqual([...expected]);
      },
    );

    it.each(["asc", "desc"] as const)(
      "a row without createdAt sorts last in %s (D-US3a)",
      async (dir) => {
        await seedSorted();
        signInAs("admin");
        const items = await walk(`?sort=createdAt&dir=${dir}`);
        const valued = items.filter((r) => r.createdAt !== undefined);
        const valueless = items.filter((r) => r.createdAt === undefined);
        expect(valueless.map((r) => r.oid)).toContain(sid(5));
        expect(items.slice(0, valued.length).every((r) => r.createdAt)).toBe(
          true,
        );
        expect(items.slice(valued.length)).toEqual(valueless);
      },
    );

    it.each(["asc", "desc"] as const)(
      "sort=team %s orders by the team's display name; no team sorts last (D-US3a)",
      async (dir) => {
        await seedSorted();
        ok(
          await addMember(
            { oid: sid(1), teamId: "team-b" },
            ctxAt(undefined, "r-t1"),
          ),
        );
        ok(
          await addMember(
            { oid: sid(2), teamId: "team-a" },
            ctxAt(undefined, "r-t2"),
          ),
        );
        signInAs("admin");
        const items = await walk(`?sort=team&dir=${dir}`);
        const ids = items.map((r) => r.oid);
        const pos = (n: number) => ids.indexOf(sid(n));
        if (dir === "asc") expect(pos(2)).toBeLessThan(pos(1));
        else expect(pos(1)).toBeLessThan(pos(2));
        // seeds 3-5 have no team: after both teamed seeds in both directions
        for (const n of [3, 4, 5]) {
          expect(pos(n)).toBeGreaterThan(Math.max(pos(1), pos(2)));
        }
      },
    );

    it.each([
      ["sort=updatedAt", "no updatedAt key (D-US3a)"],
      ["sort=bogus", "an unknown sort"],
      ["sort=", "an empty sort"],
      ["dir=sideways", "an unknown dir"],
      ["sort=name&dir=ASC", "dir is case-sensitive"],
    ])("400 for ?%s (%s)", async (query) => {
      signInAs("admin");
      const { res } = await list(`?${query}`);
      await expectError(res, 400, "BAD_REQUEST");
    });

    it.each([
      ["?sort=name&dir=asc", "?sort=email&dir=asc"],
      ["?sort=name&dir=asc", "?sort=name&dir=desc"],
      ["?sort=createdAt&dir=desc", "?sort=lastSignInAt&dir=desc"],
    ])("400 for a cursor issued under %s used under %s", async (from, to) => {
      await seedMany(30);
      signInAs("admin");
      const first = await list(from);
      const cursor = (first.body.data as { cursor?: string }).cursor;
      expect(typeof cursor).toBe("string");
      const { res } = await list(
        `${to}&cursor=${encodeURIComponent(cursor ?? "")}`,
      );
      await expectError(res, 400, "BAD_REQUEST");
    });

    it("400 for a cursor from the default sort used with an explicit other sort", async () => {
      await seedMany(30);
      signInAs("admin");
      const first = await list();
      const cursor = (first.body.data as { cursor?: string }).cursor ?? "";
      const { res } = await list(
        `?sort=email&cursor=${encodeURIComponent(cursor)}`,
      );
      await expectError(res, 400, "BAD_REQUEST");
    });

    it.each(["name", "email", "createdAt", "lastSignInAt", "team"])(
      "paging a list sorted by %s returns every identity exactly once",
      async (sort) => {
        await seedMany(30);
        await seedSorted();
        signInAs("admin");
        const unsorted = (await walk("")).map((r) => r.oid);
        const sorted = (await walk(`?sort=${sort}&dir=desc`)).map((r) => r.oid);
        expect(new Set(sorted).size).toBe(sorted.length);
        expect([...sorted].sort()).toEqual([...unsorted].sort());
        expect(sorted.length).toBeGreaterThan(25);
      },
    );

    it("answers truncated: false under the 2,000 bound (a true case is not seeded: 2,000+ items)", async () => {
      signInAs("admin");
      const { body } = await list("?sort=email");
      expect((body.data as { truncated?: boolean }).truncated).toBe(false);
    });

    it("rows carry createdAt when the record has it, omit it otherwise, and always lastSignInAt", async () => {
      await seedSorted();
      signInAs("auditor");
      const items = await walk("?sort=createdAt");
      const withDate = items.find((r) => r.oid === sid(2));
      const without = items.find((r) => r.oid === sid(5));
      expect(withDate).toMatchObject({
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSignInAt: "2026-09-01T00:00:00.000Z",
      });
      expect(without?.createdAt).toBeUndefined();
      expect(without?.lastSignInAt).toBe("2026-05-01T00:00:00.000Z");
    });

    it.each(["admin", "orgAdmin", "auditor"] as CallerName[])(
      "%s may sort",
      async (who) => {
        signInAs(who);
        const { res } = await list("?sort=lastSignInAt&dir=desc");
        expect(res.status).toBe(200);
      },
    );

    it.each(["teamAdminA", "memberA"] as const)(
      "%s (a lead or member) gets 403 on a sorted read, before the query is parsed",
      async (who) => {
        signInAs(who);
        const { res } = await list("?sort=bogus");
        await expectError(res, 403, "FORBIDDEN");
      },
    );

    it("q ignores sort and dir: at most 10 results, no cursor, no truncated flag needed", async () => {
      await seedMany(15);
      signInAs("admin");
      const { res, body } = await list("?q=company.com&sort=email&dir=desc");
      expect(res.status).toBe(200);
      expect(rows(body)).toHaveLength(10);
      expect((body.data as { cursor?: string }).cursor).toBeUndefined();
    });
  });

  // Source: docs/specs/2026-11-10-access-control.md - API routes, row
  // /api/identities/directory (D-ST2): `q` is 1-100 characters,
  // matches name, email or UPN, returns at most 10 results; a lead is 403 (D37).
  // The 400 shape itself belongs to the route-contract suite.
  describe("q search (D-ST2)", () => {
    it.each([
      ["empty", ""],
      ["101 characters", "a".repeat(101)],
    ])("400 for q of %s", async (_n, q) => {
      signInAs("admin");
      const { res } = await list(`?q=${q}`);
      await expectError(res, 400, "BAD_REQUEST");
    });

    it("accepts q of exactly 100 characters", async () => {
      signInAs("admin");
      const { res } = await list(`?q=${"a".repeat(100)}`);
      expect(res.status).toBe(200);
    });

    it("returns at most 10 results, with no cursor to a second page", async () => {
      await seedMany(15);
      signInAs("admin");
      const { res, body } = await list("?q=company.com");
      expect(res.status).toBe(200);
      expect(rows(body)).toHaveLength(10);
    });

    it("matches by display name, case-insensitively", async () => {
      await seedIdentity(oidN(90), {
        email: "zz1@company.com",
        name: "Zelda Quokka",
      });
      signInAs("admin");
      const { body } = await list("?q=quokka");
      expect(rows(body).map((r) => r.oid)).toEqual([oidN(90)]);
    });

    it("matches by email", async () => {
      await seedIdentity(oidN(91), {
        email: "uniq.mail.token@company.com",
        name: "Plain",
      });
      signInAs("admin");
      const { body } = await list("?q=uniq.mail.token");
      expect(rows(body).map((r) => r.oid)).toEqual([oidN(91)]);
    });

    it("matches by UPN", async () => {
      await seedIdentity(oidN(92), { email: "other@company.com", name: "U" });
      await putRaw({
        PK: `IDENT#${oidN(92)}`,
        SK: "META",
        gsi1pk: "IDENTS",
        gsi1sk: `IDENT#${oidN(92)}`,
        oid: oidN(92),
        tid: "00000000-0000-4000-8000-0000000000ff",
        email: "other@company.com",
        upn: "upn-only-token@tenant.onmicrosoft.com",
        displayName: "U",
        lastSignInAt: "2026-01-01T00:00:00.000Z",
        lastSeenRoles: ["internal-viewer"],
        authMethod: "entra",
        version: 1,
      });
      signInAs("admin");
      const { body } = await list("?q=upn-only-token");
      expect(rows(body).map((r) => r.oid)).toEqual([oidN(92)]);
    });

    it("returns an empty list when nothing matches", async () => {
      signInAs("admin");
      const { res, body } = await list("?q=no-such-person-xyz");
      expect(res.status).toBe(200);
      expect(rows(body)).toEqual([]);
    });

    it.each(["admin", "orgAdmin", "auditor"] as CallerName[])(
      "%s may search",
      async (who) => {
        signInAs(who);
        const { res } = await list("?q=company");
        expect(res.status).toBe(200);
      },
    );

    it.each(["teamAdminA", "memberA"] as const)(
      "%s (a lead or member) gets 403 on q (D37)",
      async (who) => {
        signInAs(who);
        const { res } = await list("?q=alice");
        await expectError(res, 403, "FORBIDDEN");
      },
    );
  });

  it("is never cached: a link written between two reads is visible on the second (Rule 60.10)", async () => {
    signInAs("admin");
    expect(rowOf(rows((await list()).body), alice.oid)?.litellm.state).toBe(
      "none",
    );
    const v1 = ok(
      await writeLiteLLMUserLink(
        {
          oid: alice.oid,
          version: null,
          write: {
            kind: "set",
            litellmUserId: "lu-alice",
            mode: "manual",
            reason: "r",
          },
        },
        ctxAt(undefined, "req-1"),
      ),
    );
    expect(rowOf(rows((await list()).body), alice.oid)).toMatchObject({
      litellm: { state: "linked", litellmUserId: "lu-alice" },
      linkVersion: v1.version,
    });
    ok(
      await writeLiteLLMUserLink(
        { oid: alice.oid, version: v1.version, write: { kind: "remove" } },
        ctxAt(undefined, "req-2"),
      ),
    );
    expect(rowOf(rows((await list()).body), alice.oid)).toMatchObject({
      litellm: { state: "none" },
      linkVersion: v1.version + 1,
    });
  });
});
