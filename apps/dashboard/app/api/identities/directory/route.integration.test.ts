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
