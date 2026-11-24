import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LTEAM,
  UNLINKED_LTEAM,
  enterProd,
  call,
  defineTeamReadContract,
  expectNoSentinels,
  stubLiteLLMEnv,
  useEnv,
} from "@/test/fakes/fake-litellm-views";
import {
  BOB_LUSER,
  PEOPLE,
  bodyOf,
  callsTo,
  defineMemberWriteContract,
  expectError,
  installMemberWritesFake,
  memberAudit,
  send,
  setToggles,
  setupMemberWritesSuite,
  writeCalls,
} from "@/test/support/litellm-member-writes-support";
import { createAppTeam } from "@/lib/data/access/app-teams";
import { putTeamLink } from "@/lib/data/litellm/team-links";
import { createPendingItem } from "@/lib/data/access/pending";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { seedMember } from "@/test/support/matrix-route-support";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";
import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import type { FakeCall } from "@/test/fakes/fake-litellm";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import { memberWritesHandler } from "@/test/support/litellm-member-writes-support";
import { putRaw } from "@/test/support/test-support";
import {
  ENTRA_ISSUER,
  FOREIGN_TENANT,
  GUEST_UPN,
  linkIdentityToLiteLLMUser,
  seedLiteLLMConnection,
  seedSignedIn,
} from "@/test/support/invite-accept-support";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId]/members GET in scope), "Roles and rights" (Lead sees members' spend,
// budgets and limits), "Reads" (getTeam; team_memberships are loose rows),
// "Identity mapping and members", implementation-phases L3 Verify, Rule 60.23.
//
// Contract for the developer (.../members/route.ts, GET):
//   200 data = { connected: false, items: [] } when unlinked, else
//   { connected: true,
//     items: [{ email, spend, maxBudget, rpmLimit, tpmLimit, ... }] }  (allowlisted fields only)
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

// W1 seam (Rule 60.17, review of unit INV2): the identity read keeps its real
// DynamoDB behaviour; a test lowers the bound so a small table is cut, as the
// directory's 2,000 bound would be in production (US1, D-US3).
const identityBound = vi.hoisted(() => ({
  value: undefined as number | undefined,
}));
vi.mock("@/lib/data/access/identities", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@/lib/data/access/identities")>();
  return {
    ...mod,
    listIdentitiesBounded: (opts: { bound?: number } = {}) =>
      mod.listIdentitiesBounded(
        identityBound.value === undefined
          ? opts
          : { ...opts, bound: identityBound.value },
      ),
  };
});

const state = setupMemberWritesSuite();
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).GET;
};

defineTeamReadContract(state, {
  full: false,
  load,
  suffix: "/members",
  query: "",
  toggleOp: "getTeam",
  upstreamPath: "/team/info",
});

describe("GET /api/litellm/teams/[teamId]/members", () => {
  it("lists members with their LiteLLM-reported spend, budget and limits (Roles and rights: Lead)", async () => {
    signInAs("teamAdminA");
    const { body } = await call(
      await load(),
      "/api/litellm/teams/team-a/members",
      {
        teamId: "team-a",
      },
    );
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      email: "a1@company.com",
      spend: 3.25,
      maxBudget: 10,
      rpmLimit: 5,
      tpmLimit: 500,
    });
    expect(JSON.stringify(state.fake.calls.map((c) => c.url))).toContain(
      LTEAM["team-a"],
    );
  });

  it("membership rows are reduced to allowlisted fields (cost visualisation; LT1)", async () => {
    signInAs("admin");
    const { body } = await call(
      await load(),
      "/api/litellm/teams/team-a/members",
      {
        teamId: "team-a",
      },
    );
    expectNoSentinels(body);
    for (const banned of ["budget_id", "created_by", "litellm_budget_table"]) {
      expect(JSON.stringify(body)).not.toContain(banned);
    }
  });
});

// Source: Design System - "LiteLLM members with no app membership (unit RS1;
// D6-D7)" (D7) and its match-precedence ruling R2: a LiteLLM member matches a member of
// the app team by `user_id`, by email, or by the identity link - its `user_id`
// equals the team member's `litellmUserId` - so the Team page and the RS1
// dialogs find the same people. Contract: the matched item carries the app
// member's `oid` and `name`; an unmatched one carries neither. Links of people
// outside the app team (another team, or no membership) never match.
describe("GET /api/litellm/teams/[teamId]/members - matching an app member (RS1 D7)", () => {
  const LINKED_ID = "uid-bob-7";

  async function linkLiteLLMUser(oid: string, litellmUserId: string) {
    await putRaw({
      PK: `IDENT#${oid}`,
      SK: "LINK",
      oid,
      usageIdentities: [],
      aliases: [],
      litellmUserId,
      version: 1,
      updatedAt: "2026-11-01T00:00:00.000Z",
    });
  }

  // team-a's LiteLLM team lists exactly these members; `email` is what
  // members_with_roles reports (absent: the row's email falls back to user_id).
  // `identity` (B1 round 1b): what GET /user/list reports as `sso_user_id`
  // per LiteLLM user id, or `fail` to make that read error.
  function listMembers(
    rows: Array<{ id: string; email?: string }>,
    identity: { sso?: Record<string, string>; fail?: boolean } = {},
  ) {
    const base = memberWritesHandler();
    state.fake = createFakeLiteLLM((call: FakeCall, attempt: number) => {
      if (call.method === "GET" && call.path === "/user/list") {
        if (identity.fail) {
          return { status: 500, body: { detail: "gateway error" } };
        }
        const q = new URL(call.url).searchParams;
        const needle = (
          q.get("search") ??
          q.get("user_email") ??
          q.get("user_id") ??
          ""
        ).toLowerCase();
        const users = rows
          .filter(
            (r) =>
              !needle ||
              r.id.toLowerCase().includes(needle) ||
              (r.email ?? "").toLowerCase().includes(needle),
          )
          .map((r) => ({
            user_id: r.id,
            user_email: r.email ?? r.id,
            user_role: "internal_user",
            spend: 0,
            max_budget: null,
            teams: [] as string[],
            ...(identity.sso?.[r.id]
              ? { sso_user_id: identity.sso[r.id] }
              : {}),
          }));
        return {
          status: 200,
          body: {
            users,
            total: users.length,
            page: 1,
            page_size: 25,
            total_pages: 1,
          },
        };
      }
      const reply = base(call, attempt);
      if (
        `${call.method} ${call.path}` !== "GET /team/info" ||
        typeof reply === "string"
      ) {
        return reply;
      }
      const body = reply.body as {
        team_info: Record<string, unknown>;
      } & Record<string, unknown>;
      return {
        status: reply.status,
        body: {
          ...body,
          team_info: {
            ...body.team_info,
            members_with_roles: rows.flatMap((r) =>
              r.email
                ? [{ user_id: r.id, user_email: r.email, role: "user" }]
                : [],
            ),
          },
          team_memberships: rows.map((r) => ({
            user_id: r.id,
            team_id: LTEAM["team-a"],
            spend: 1,
          })),
        },
      };
    });
    vi.stubGlobal("fetch", state.fake.fetch);
  }

  const items = async () => {
    signInAs("admin");
    const { body } = await call(
      await load(),
      "/api/litellm/teams/team-a/members",
      { teamId: "team-a" },
    );
    return body.data.items as Array<{
      userId: string;
      oid?: string;
      name?: string;
    }>;
  };

  it("matches by the identity link: user_id equals the member's litellmUserId, though user_id and email differ from the app member's (D7)", async () => {
    await linkLiteLLMUser(PEOPLE.bob.oid, LINKED_ID);
    listMembers([{ id: LINKED_ID, email: "someone.else@vendor.example" }]);

    expect(await items()).toEqual([
      expect.objectContaining({
        userId: LINKED_ID,
        oid: PEOPLE.bob.oid,
        name: PEOPLE.bob.name,
      }),
    ]);
  });

  // Source: Design System - "LiteLLM members with no app membership" (R2,
  // 2026-11-18): an identity-link match takes precedence over email and
  // usage-identity matches, so a row never shows the wrong person. Both
  // member orders run: the map is built concurrently, so a last-write-wins
  // bug would only show for one of them.
  it.each([
    ["bob", "alice"],
    ["alice", "bob"],
  ] as const)(
    "a user_id equal to %s's litellmUserId wins over the email of %s, which is a different member (R2)",
    async (linked, other) => {
      await linkLiteLLMUser(PEOPLE[linked].oid, LINKED_ID);
      listMembers([{ id: LINKED_ID, email: PEOPLE[other].email }]);

      expect(await items()).toEqual([
        expect.objectContaining({
          userId: LINKED_ID,
          oid: PEOPLE[linked].oid,
          name: PEOPLE[linked].name,
        }),
      ]);
    },
  );

  it.each([
    ["bob", "alice"],
    ["alice", "bob"],
  ] as const)(
    "a user_id equal to %s's litellmUserId wins over a usage identity of %s listing the same id (R2)",
    async (linked, other) => {
      await linkLiteLLMUser(PEOPLE[linked].oid, LINKED_ID);
      await putRaw({
        PK: `IDENT#${PEOPLE[other].oid}`,
        SK: "LINK",
        oid: PEOPLE[other].oid,
        usageIdentities: [LINKED_ID],
        aliases: [],
        version: 1,
        updatedAt: "2026-11-01T00:00:00.000Z",
      });
      listMembers([{ id: LINKED_ID }]);

      expect(await items()).toEqual([
        expect.objectContaining({ userId: LINKED_ID, oid: PEOPLE[linked].oid }),
      ]);
    },
  );

  it("matching by user_id equal to the member's email, and by LiteLLM email, is unchanged (Identity mapping)", async () => {
    listMembers([
      { id: PEOPLE.alice.email },
      { id: "uid-other-1", email: PEOPLE.bob.email },
    ]);

    const rows = await items();

    expect(rows.find((r) => r.userId === PEOPLE.alice.email)?.oid).toBe(
      PEOPLE.alice.oid,
    );
    expect(rows.find((r) => r.userId === "uid-other-1")?.oid).toBe(
      PEOPLE.bob.oid,
    );
  });

  it("a link belonging to a member of ANOTHER team does not match (no cross-team leakage; LT1)", async () => {
    await linkLiteLLMUser(CALLERS.memberB.oid, "uid-teamb-9");
    listMembers([{ id: "uid-teamb-9", email: "b9@vendor.example" }]);

    const [row] = await items();

    expect(row).toBeDefined();
    expect(row?.oid).toBeUndefined();
    expect(row?.name).toBeUndefined();
  });

  it("a link of a person who is not a member of any team, and an unlinked LiteLLM user, do not match", async () => {
    await linkLiteLLMUser(PEOPLE.carol.oid, "uid-carol-3");
    listMembers([
      { id: "uid-carol-3", email: "c3@vendor.example" },
      { id: "uid-nobody", email: "nobody@vendor.example" },
    ]);

    const rows = await items();

    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.oid).toBeUndefined();
      expect(r.name).toBeUndefined();
    }
  });

  // Source: Access Control - "Placing a person by hand" (for callers who may
  // write members, a person's row carries a state: `signed-in`, `invited` or
  // `unknown`; readers get none), Design System - "Placing a person by hand",
  // T-IV3 (states only for teams in scope: an invite pending for another team
  // does not show on this team's rows; an out-of-scope team is the unchanged
  // 404 of the read contract above), T-IV5 (a reader never sees who is invited).
  // Agent decision, to be recorded in the spec: the state of a row is about this
  // team - `invited` is a pending member invite for the row's email on this team;
  // `signed-in` is a member with an oid or a person matched by the *Same
  // person* keys (Access Control - Same person; one function, B2 of the INV2
  // review); otherwise `unknown`.
  describe("row state (Placing a person by hand; T-IV3, T-IV5)", () => {
    const INVITED = "Invitee@Vendor.Example";
    const rowsFor = [
      { id: "uid-alice", email: PEOPLE.alice.email },
      { id: "uid-carol", email: PEOPLE.carol.email },
      { id: "uid-pending", email: INVITED },
      { id: "uid-stranger", email: "stranger@vendor.example" },
      { id: "uid-elsewhere", email: "elsewhere@vendor.example" },
    ];
    const WRITERS = [
      "admin",
      "orgAdmin",
      "teamAdminA",
      "deptAdminEng",
    ] as const;

    // Carol signed in as an Entra identity of the configured tenant whose UPN
    // is her email (Access Control - Same person: the email key); the tenant
    // is read from the Entra issuer.
    beforeEach(async () => {
      useEnv({
        AUTH_MICROSOFT_ENTRA_ID_ID: "client-id-test",
        AUTH_MICROSOFT_ENTRA_ID_ISSUER: ENTRA_ISSUER,
      });
      await seedSignedIn(PEOPLE.carol.oid, {
        upn: PEOPLE.carol.email,
        email: PEOPLE.carol.email,
        displayName: PEOPLE.carol.name,
      });
    });

    async function read(caller: CallerName) {
      listMembers(rowsFor);
      ok(
        await createPendingItem(
          {
            kind: "affiliation",
            emailOrUpn: INVITED.toLowerCase(),
            teamId: "team-a",
          },
          ctxAt(undefined, "req-state-invite-a"),
        ),
      );
      ok(
        await createPendingItem(
          {
            kind: "affiliation",
            emailOrUpn: "elsewhere@vendor.example",
            teamId: "team-b",
          },
          ctxAt(undefined, "req-state-invite-b"),
        ),
      );
      signInAs(caller);
      return call(await load(), "/api/litellm/teams/team-a/members", {
        teamId: "team-a",
      });
    }
    const stateOf = (items: Array<{ userId: string; state?: string }>) =>
      Object.fromEntries(items.map((m) => [m.userId, m.state]));

    it.each(WRITERS)(
      "%s: a team member and a person matched by the Same person keys are signed-in, a pending invite on this team is invited, anyone else (and an invite for another team) is unknown",
      async (caller) => {
        const { body } = await read(caller);
        expect(stateOf(body.data.items)).toEqual({
          "uid-alice": "signed-in",
          "uid-carol": "signed-in",
          "uid-pending": "invited",
          "uid-stranger": "unknown",
          "uid-elsewhere": "unknown",
        });
      },
    );

    it("the Auditor reads the same rows with no state field and no hint of who is invited (T-IV5)", async () => {
      const { res, body, text } = await read("auditor");
      expect(res.status).toBe(200);
      expect(body.data.items).toHaveLength(rowsFor.length);
      for (const item of body.data.items) {
        expect(item).not.toHaveProperty("state");
      }
      expect(text).not.toContain('"state"');
      expect(text).not.toContain("invited");
    });

    // Access Control - "Placing a person by hand" (a signed-in person who is not
    // a member of the team carries `identityOid` for Add to team; `oid` keeps
    // meaning a matched member), T-IV5 (readers get neither identityOid nor state).
    it.each(WRITERS)(
      "%s: a signed-in person who is not a member carries identityOid and no oid; a member keeps oid and has no identityOid; an invited or unknown row has neither",
      async (caller) => {
        const { body } = await read(caller);
        const byId = Object.fromEntries(
          body.data.items.map((m: { userId: string }) => [m.userId, m]),
        );
        expect(byId["uid-carol"].identityOid).toBe(PEOPLE.carol.oid);
        expect(byId["uid-carol"]).not.toHaveProperty("oid");
        expect(byId["uid-alice"].oid).toBe(PEOPLE.alice.oid);
        expect(byId["uid-alice"]).not.toHaveProperty("identityOid");
        for (const id of ["uid-pending", "uid-stranger", "uid-elsewhere"]) {
          expect(byId[id]).not.toHaveProperty("identityOid");
          expect(byId[id]).not.toHaveProperty("oid");
        }
      },
    );

    it("the Auditor sees no identityOid, so the oid of a person who signed in is not disclosed (T-IV5)", async () => {
      const { body, text } = await read("auditor");
      for (const item of body.data.items) {
        expect(item).not.toHaveProperty("identityOid");
      }
      expect(text).not.toContain("identityOid");
      expect(text).not.toContain(PEOPLE.carol.oid);
    });
  });

  // Access Control - "Same person" and "Match keys per sign-in mode" (the Entra
  // id, then the tenant-checked non-guest UPN; one function, `matchLiteLLMUser`;
  // two matches, or keys that disagree, mean no link), "Placing a person by
  // hand" (Add to team needs a signed-in person with no team), T2 (the `email`
  // claim is not a match key) and T-IV2 (an unverified LiteLLM email never
  // selects a person). Review B1 of unit INV2: the earlier round-2 case that
  // set `identityOid` from a stored-email match alone was wrong by these
  // rules and is replaced by the cases below.
  describe("identityOid only on a unique Same person match (B1; T2, T-IV2)", () => {
    const X = "00000000-0000-4000-8000-0000000004a1";
    const Y = "00000000-0000-4000-8000-0000000004a2";
    const ANN_UPN = "ann@corp.example.com";

    beforeEach(() => {
      useEnv({
        AUTH_MICROSOFT_ENTRA_ID_ID: "client-id-test",
        AUTH_MICROSOFT_ENTRA_ID_ISSUER: ENTRA_ISSUER,
      });
    });

    async function itemsFor(
      rows: Array<{ id: string; email: string }>,
      identity: { sso?: Record<string, string>; fail?: boolean } = {},
    ) {
      listMembers(rows, identity);
      signInAs("admin");
      const { body } = await call(
        await load(),
        "/api/litellm/teams/team-a/members",
        { teamId: "team-a" },
      );
      return Object.fromEntries(
        body.data.items.map((m: { userId: string }) => [m.userId, m]),
      ) as Record<string, Record<string, unknown>>;
    }

    it("the Entra id key alone: an Entra-id match with a different email gives identityOid, name and email", async () => {
      await seedSignedIn(X, {
        upn: ANN_UPN,
        email: "ann.stored@corp.example.com",
        displayName: "Ann Lee",
      });
      const items = await itemsFor([
        { id: X, email: "someone.else@vendor.example" },
      ]);
      expect(items[X]).toMatchObject({
        identityOid: X,
        identityName: "Ann Lee",
        identityEmail: "ann.stored@corp.example.com",
      });
    });

    it("the UPN email key: a tenant UPN equal to the LiteLLM email gives identityOid", async () => {
      await seedSignedIn(X, {
        upn: ANN_UPN,
        email: "ann.stored@corp.example.com",
        displayName: "Ann Lee",
      });
      const items = await itemsFor([{ id: "uid-ann", email: ANN_UPN }]);
      expect(items["uid-ann"]).toMatchObject({
        identityOid: X,
        identityName: "Ann Lee",
      });
    });

    it("(a) a guest UPN never matches: neither the guest UPN nor the stored email selects the person", async () => {
      await seedSignedIn(X, {
        upn: GUEST_UPN,
        email: "jane@example.com",
        displayName: "Jane",
      });
      const items = await itemsFor([
        { id: "uid-guest-upn", email: GUEST_UPN },
        { id: "uid-guest-mail", email: "jane@example.com" },
      ]);
      for (const id of ["uid-guest-upn", "uid-guest-mail"]) {
        expect(items[id]).not.toHaveProperty("identityOid");
      }
    });

    it("(b) an identity of a foreign tenant never matches by email", async () => {
      await seedSignedIn(X, {
        upn: ANN_UPN,
        email: ANN_UPN,
        tid: FOREIGN_TENANT,
        displayName: "Ann Lee",
      });
      const items = await itemsFor([{ id: "uid-ann", email: ANN_UPN }]);
      expect(items["uid-ann"]).not.toHaveProperty("identityOid");
    });

    it("(c) an email-claim-only match (T2, T-IV2): the stored email equals the LiteLLM email, the UPN does not, no Entra id", async () => {
      await seedSignedIn(X, {
        upn: "ann.upn@corp.example.com",
        email: ANN_UPN,
        displayName: "Ann Lee",
      });
      const items = await itemsFor([{ id: "uid-ann", email: ANN_UPN }]);
      expect(items["uid-ann"]).not.toHaveProperty("identityOid");
      expect(items["uid-ann"]).not.toHaveProperty("identityName");
      expect(items["uid-ann"]).not.toHaveProperty("identityEmail");
    });

    it("(d) a duplicate: two identities with the key give no identityOid on the row", async () => {
      await seedSignedIn(X, { upn: ANN_UPN, email: ANN_UPN });
      await seedSignedIn(Y, { upn: ANN_UPN, email: ANN_UPN });
      const items = await itemsFor([{ id: "uid-ann", email: ANN_UPN }]);
      expect(items["uid-ann"]).not.toHaveProperty("identityOid");
    });

    it("(e) the keys disagree: the Entra id matches one identity and the email another, so neither is chosen", async () => {
      await seedSignedIn(X, { upn: ANN_UPN, email: ANN_UPN });
      await seedSignedIn(Y, {
        upn: "yan@corp.example.com",
        email: "yan@corp.example.com",
      });
      const items = await itemsFor([{ id: X, email: "yan@corp.example.com" }]);
      expect(items[X]).not.toHaveProperty("identityOid");
    });

    it.each(["team-a", "team-b"])(
      "(f) an identity that already has a team (%s) is not offered Add to team",
      async (teamId) => {
        await seedSignedIn(X, { upn: ANN_UPN, email: ANN_UPN });
        await seedMember(X, teamId);
        const items = await itemsFor([{ id: "uid-ann", email: ANN_UPN }]);
        expect(items["uid-ann"]).not.toHaveProperty("identityOid");
      },
    );

    // Round 1b (B1 gap, fail closed; Access Control - "Same person" ("ambiguous
    // or disagreeing keys are no match") and "Placing a person by hand"; T2,
    // T-IV2): the match uses the LiteLLM user's real sso_user_id, and the
    // stored link wins.
    it("(g) the stored link wins: identity C holds the link to the LiteLLM user, so identityOid is C though its email differs and another identity matches the email (T-IV2)", async () => {
      const C = "00000000-0000-4000-8000-0000000004c3";
      await seedLiteLLMConnection();
      await seedSignedIn(C, {
        upn: "carl@corp.example.com",
        email: "carl@corp.example.com",
        displayName: "Carl",
      });
      await seedSignedIn(X, { upn: ANN_UPN, email: ANN_UPN });
      await linkIdentityToLiteLLMUser(C, "uid-ann");
      const items = await itemsFor([{ id: "uid-ann", email: ANN_UPN }]);
      expect(items["uid-ann"]).toMatchObject({
        identityOid: C,
        identityName: "Carl",
      });
    });

    // Review R2-W1: a stored link owner that is not among the signed-in people
    // (gone, cut by the bounded read, or never signed in) is no match; the
    // email key must not be consulted as a fallback.
    it("(g2) a stored link whose owner is not among the signed-in people gives no identityOid, though identity X matches the email key (Same person; Placing a person by hand; T2)", async () => {
      const GONE = "00000000-0000-4000-8000-0000000004c4";
      await seedLiteLLMConnection();
      await seedSignedIn(X, { upn: ANN_UPN, email: ANN_UPN });
      await linkIdentityToLiteLLMUser(GONE, "uid-ann");
      const items = await itemsFor([{ id: "uid-ann", email: ANN_UPN }]);
      expect(items["uid-ann"]).not.toHaveProperty("identityOid");
    });

    it("(h) disagreement: the email key names identity X but sso_user_id is identity Y's oid, so identityOid is absent (T2, T-IV2)", async () => {
      await seedSignedIn(X, { upn: ANN_UPN, email: ANN_UPN });
      await seedSignedIn(Y, {
        upn: "yan@corp.example.com",
        email: "yan@corp.example.com",
      });
      const items = await itemsFor([{ id: "uid-ann", email: ANN_UPN }], {
        sso: { "uid-ann": Y },
      });
      expect(items["uid-ann"]).not.toHaveProperty("identityOid");
    });

    it("(i) fail closed: when the sso_user_id read errors, an email-key-only match gets no identityOid, an Entra-id match on user_id still does (T2)", async () => {
      await seedSignedIn(X, {
        upn: "xena@corp.example.com",
        email: "xena@corp.example.com",
        displayName: "Xena",
      });
      await seedSignedIn(Y, { upn: ANN_UPN, email: ANN_UPN });
      const items = await itemsFor(
        [
          { id: X, email: "other@vendor.example" },
          { id: "uid-ann", email: ANN_UPN },
        ],
        { fail: true },
      );
      expect(items["uid-ann"]).not.toHaveProperty("identityOid");
      expect(items[X]).toMatchObject({ identityOid: X });
    });

    it("the Auditor sees none of identityOid, identityName or identityEmail (T-IV5)", async () => {
      await seedSignedIn(X, {
        upn: ANN_UPN,
        email: ANN_UPN,
        displayName: "Ann Lee",
      });
      listMembers([{ id: "uid-ann", email: ANN_UPN }]);
      signInAs("auditor");
      const { text } = await call(
        await load(),
        "/api/litellm/teams/team-a/members",
        { teamId: "team-a" },
      );
      for (const key of ["identityOid", "identityName", "identityEmail"]) {
        expect(text).not.toContain(key);
      }
      expect(text).not.toContain("Ann Lee");
    });
  });

  // Rule 60.17 (no silent failure), review W1 of unit INV2: the bounded
  // identity read can be cut; the response says so (as the directory does,
  // US1 / D-US3) for the callers who read identities.
  describe("truncated identity list (W1; Rule 60.17)", () => {
    beforeEach(() => {
      useEnv({
        AUTH_MICROSOFT_ENTRA_ID_ID: "client-id-test",
        AUTH_MICROSOFT_ENTRA_ID_ISSUER: ENTRA_ISSUER,
      });
    });
    afterEach(() => {
      identityBound.value = undefined;
    });

    async function readAs(caller: CallerName) {
      listMembers([{ id: "uid-x", email: "x@vendor.example" }]);
      signInAs(caller);
      return call(await load(), "/api/litellm/teams/team-a/members", {
        teamId: "team-a",
      });
    }

    it("a writer gets truncated: true when the identity list was cut, false when it was not", async () => {
      identityBound.value = 1;
      expect((await readAs("admin")).body.data.truncated).toBe(true);
      identityBound.value = undefined;
      expect((await readAs("admin")).body.data.truncated).toBe(false);
    });

    it("the Auditor reads no identities, so the response carries no truncated key (T-IV5)", async () => {
      identityBound.value = 1;
      const { body } = await readAs("auditor");
      expect(body.data).not.toHaveProperty("truncated");
    });
  });
});

// Source: docs/specs/2026-11-10-litellm.md -- "Team configuration page (L4)"
// (members: add), "Writes" (addTeamMember: Lead for existing dashboard members
// of the team, Admin), LD23 (identities carry no cost); coordinator decision
// 2026-11-16. Contract: GET .../members also returns
//   candidates: [{ oid, name, email }]
// = dashboard members of [teamId] (with an identity email) who are not
// members of the linked LiteLLM team (matched by email). Present only for
// callers who can write members (Lead in scope, org-admin, Admin); the key is
// absent for the Auditor. Identities only: never spend or budget, so the
// Organisation cap leaves it untouched.
describe("GET /api/litellm/teams/[teamId]/members - candidates (add-member picker)", () => {
  const get = async () =>
    call(await load(), "/api/litellm/teams/team-a/members", {
      teamId: "team-a",
    });
  const sorted = (rows: Array<{ oid: string }>) =>
    rows.map((r) => r.oid).sort();

  it.each(["admin", "orgAdmin", "teamAdminA", "deptAdminEng"] as const)(
    "%s gets the dashboard members not yet in the LiteLLM team, identities only",
    async (who) => {
      signInAs(who);
      const { body } = await get();
      expect(sorted(body.data.candidates)).toEqual(
        [PEOPLE.alice.oid, PEOPLE.bob.oid].sort(),
      );
      const alice = body.data.candidates.find(
        (c: { oid: string }) => c.oid === PEOPLE.alice.oid,
      );
      // Placing a person by hand: a candidate is a dashboard member, so signed-in.
      expect(alice).toEqual({
        oid: PEOPLE.alice.oid,
        name: PEOPLE.alice.name,
        email: PEOPLE.alice.email,
        state: "signed-in",
      });
    },
  );

  it("excludes a dashboard member who is already in the LiteLLM team (memberA, a1@company.com)", async () => {
    signInAs("admin");
    const { body } = await get();
    const emails = body.data.candidates.map((c: { email: string }) => c.email);
    expect(emails).not.toContain("a1@company.com");
  });

  it("the Auditor gets no candidates key (cannot write members)", async () => {
    signInAs("auditor");
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(body.data).not.toHaveProperty("candidates");
  });

  it("a Lead still gets candidates under the Organisation cap, with no cost fields (LD23)", async () => {
    await enterProd();
    signInAs("teamAdminA");
    const { body } = await get();
    expect(body.data.candidates).toHaveLength(2);
    for (const c of body.data.candidates) {
      expect(Object.keys(c).sort()).toEqual(["email", "name", "oid", "state"]);
    }
  });
});

// Source: docs/specs/2026-11-17-app-teams.md - "Teams without an AWS account"
// (a created team takes members and a link); Access Control MI-D7 (a department
// scope covers a created team by its stored departmentId), T-MI4. The add
// candidates are offered only when the team is known and the caller may write
// its members; that lookup reads the team directory (M2 design 1, group M2-b).
describe("GET /api/litellm/teams/[teamId]/members - candidates of a linked created team (App Teams; MI-D7)", () => {
  let created: string;
  const get = async () =>
    call(await load(), `/api/litellm/teams/${created}/members`, {
      teamId: created,
    });
  beforeEach(async () => {
    created = ok(
      await createAppTeam(
        {
          name: "Guild",
          departmentId: "dept-eng",
          departmentName: "Engineering",
        },
        ctxAt(undefined, "req-members-created"),
      ),
    ).teamId;
    ok(
      await putTeamLink(
        { teamId: created, litellmTeamId: UNLINKED_LTEAM, version: null },
        ctxAt(undefined, "req-members-created-link"),
      ),
    );
    await seedMember(PEOPLE.carol.oid, created);
  });

  it.each(["admin", "orgAdmin", "deptAdminEng"] as const)(
    "%s gets the created team's dashboard member as an add candidate, identities only",
    async (who) => {
      signInAs(who);
      const { res, body } = await get();
      expect(res.status).toBe(200);
      expect(body.data.candidates).toEqual([
        {
          oid: PEOPLE.carol.oid,
          name: PEOPLE.carol.name,
          email: PEOPLE.carol.email,
          state: "signed-in",
        },
      ]);
    },
  );

  it("the Auditor reads the team but gets no candidates key; a Lead of another team gets 404 (T-MI4)", async () => {
    signInAs("auditor");
    const audit = await get();
    expect(audit.res.status).toBe(200);
    expect(audit.body.data).not.toHaveProperty("candidates");
    signInAs("teamAdminA");
    expect((await get()).res.status).toBe(404);
  });
});

// Source: docs/specs/2026-11-10-litellm.md LD23 (per-user LiteLLM cost obeys
// the Organisation cap), "Roles and rights"; Access Control - "Organisation
// cap", T16. Decision: capped member items keep identity and limits (email,
// userId, rpmLimit, tpmLimit, oid, name) and OMIT `spend`, `maxBudget` and
// `budgetDuration` (absent keys). The team-level totals are not per-user and
// are untouched.
describe("GET /api/litellm/teams/[teamId]/members - Organisation cap (LD23, T16)", () => {
  it.each([
    "admin",
    "orgAdmin",
    "auditor",
    "teamAdminA",
    "deptAdminEng",
  ] as const)(
    "%s in prod without the approval gets member identities but no per-user spend or budget",
    async (who) => {
      await enterProd();
      signInAs(who);
      const { res, body } = await call(
        await load(),
        "/api/litellm/teams/team-a/members",
        { teamId: "team-a" },
      );
      expect(res.status).toBe(200);
      expect(body.data.items).toHaveLength(1);
      const item = body.data.items[0];
      expect(item.email).toBe("a1@company.com");
      for (const field of ["spend", "maxBudget", "budgetDuration"]) {
        expect(item, field).not.toHaveProperty(field);
      }
    },
  );

  it("with the approval recorded, spend and budget are present again (LD23)", async () => {
    await enterProd({ approved: true });
    signInAs("teamAdminA");
    const { body } = await call(
      await load(),
      "/api/litellm/teams/team-a/members",
      { teamId: "team-a" },
    );
    expect(body.data.items[0]).toMatchObject({ spend: 3.25, maxBudget: 10 });
  });
});

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (addTeamMember: Lead only
// for existing dashboard members of the team, Admin; user body user_id =
// user_email = lower-cased email, user_role internal_user, auto_create_key
// false, send_invite_email false; member body team_id, member {user_id, role
// "user"}, max_budget_in_team, budget_duration; audit litellmUserId, budget),
// "Allowlist" (privileged targets: 409 PRIVILEGED_TARGET with no write, also
// recorded as denied), "Identity mapping and members" (OSS creates a missing
// user; Enterprise never creates one: 409 CONFLICT; the id stored is the one
// LiteLLM returns), "Budgets and limits" (member budget <= team max_budget),
// LD10, LD12, LT13, LT16, LT18.
//
// Contract: POST /api/litellm/teams/[teamId]/members, strict body
//   { oid: string, maxBudgetInTeam?: number > 0, budgetDuration?: string }.
//   201 { data: { oid, litellmUserId } }. Order: scope/permission (403/404),
//   body (400), link (409 CONFLICT when the team is unlinked), toggle (403),
//   then the oid must be a dashboard member of [teamId] (else 404 NOT_FOUND,
//   no write) with an identity email; reads: GET /user/list?user_email=, then
//   GET /user/info for the role check; writes: POST /user/new (OSS, missing
//   only) then POST /team/member_add. Audit litellm.member.add, target
//   { type: "litellm-user", id: litellmUserId }, after { litellmUserId,
//   maxBudgetInTeam? }.
const loadPost = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).POST;
};
const PATTERN = "/api/litellm/teams/[teamId]/members";
const membersUrl = (team: string) => `/api/litellm/teams/${team}/members`;

defineMemberWriteContract(state, {
  method: "POST",
  pattern: PATTERN,
  action: "litellm.member.add",
  toggleOp: "addTeamMember",
  okStatus: 201,
  load: loadPost,
  path: (team) => membersUrl(team),
  body: { oid: PEOPLE.alice.oid },
  target: PEOPLE.alice.oid,
  isAdd: true,
});

describe("POST /api/litellm/teams/[teamId]/members", () => {
  const add = async (payload: unknown, team = "team-a") =>
    send(await loadPost(), {
      method: "POST",
      path: membersUrl(team),
      params: { teamId: team },
      body: payload,
    });

  it("OSS: creates a missing LiteLLM user with the exact body, then adds the member, and audits it (Writes; Identity mapping)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await add({
      oid: PEOPLE.alice.oid,
      maxBudgetInTeam: 20,
      budgetDuration: "30d",
    });
    expect(res.status).toBe(201);
    expect(body.data).toEqual({
      oid: PEOPLE.alice.oid,
      litellmUserId: PEOPLE.alice.email,
    });
    expect(writeCalls(state).map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /user/new",
      "POST /team/member_add",
    ]);
    expect(bodyOf(callsTo(state, "POST /user/new")[0])).toEqual({
      user_id: PEOPLE.alice.email,
      user_email: PEOPLE.alice.email,
      user_role: "internal_user",
      auto_create_key: false,
      send_invite_email: false,
    });
    expect(bodyOf(callsTo(state, "POST /team/member_add")[0])).toEqual({
      team_id: LTEAM["team-a"],
      member: { user_id: PEOPLE.alice.email, role: "user" },
      max_budget_in_team: 20,
      budget_duration: "30d",
    });
    expect(JSON.stringify(body)).not.toContain("sk-AUTOCREATED-TRAP");
    const [record, ...rest] = await memberAudit();
    expect(rest).toHaveLength(0);
    expect(record).toMatchObject({
      action: "litellm.member.add",
      result: "success",
      actor: CALLERS.teamAdminA.oid,
      teamId: "team-a",
      target: { type: "litellm-user", id: PEOPLE.alice.email },
      after: { litellmUserId: PEOPLE.alice.email, maxBudgetInTeam: 20 },
    });
    expect(JSON.stringify(record)).not.toContain("sk-AUTOCREATED-TRAP");
  });

  // Source: LiteLLM spec - the LW1 paragraph after `createUser`
  // (`addTeamMember` is unchanged; "Add member still creates a missing
  // LiteLLM user"), test T-LW3.
  it("SSO enabled: a missing LiteLLM user is still created, then added, exactly as without SSO (T-LW3)", async () => {
    useEnv({
      AUTH_MICROSOFT_ENTRA_ID_ID: "00000000-0000-4000-8000-000000000001",
    });
    signInAs("teamAdminA");
    const { res, body } = await add({ oid: PEOPLE.alice.oid });
    expect(res.status).toBe(201);
    expect(body.data).toEqual({
      oid: PEOPLE.alice.oid,
      litellmUserId: PEOPLE.alice.email,
    });
    expect(writeCalls(state).map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /user/new",
      "POST /team/member_add",
    ]);
  });

  it("an existing LiteLLM user is added without /user/new, using the id LiteLLM returned (Identity mapping)", async () => {
    signInAs("admin");
    const { res, body } = await add({ oid: PEOPLE.bob.oid });
    expect(res.status).toBe(201);
    expect(body.data.litellmUserId).toBe(BOB_LUSER);
    expect(callsTo(state, "POST /user/new")).toHaveLength(0);
    expect(bodyOf(callsTo(state, "POST /team/member_add")[0])).toEqual({
      team_id: LTEAM["team-a"],
      member: { user_id: BOB_LUSER, role: "user" },
    });
  });

  it("Enterprise: a person not yet signed in to LiteLLM is 409 CONFLICT and /user/new is never called (LT16)", async () => {
    await enterProd();
    signInAs("admin");
    const { res } = await add({ oid: PEOPLE.alice.oid });
    await expectError(res, 409, "CONFLICT");
    expect(writeCalls(state)).toHaveLength(0);
  });

  it("Enterprise: an existing LiteLLM user is added with the user_id LiteLLM returned (Identity mapping)", async () => {
    await enterProd();
    signInAs("admin");
    const { res } = await add({ oid: PEOPLE.bob.oid });
    expect(res.status).toBe(201);
    expect(callsTo(state, "POST /user/new")).toHaveLength(0);
    expect(callsTo(state, "POST /team/member_add")).toHaveLength(1);
  });

  it.each(["proxy_admin", "proxy_admin_viewer"])(
    "a %s target is 409 PRIVILEGED_TARGET with no LiteLLM write, recorded as a denied attempt (LT18, LD12)",
    async (role) => {
      installMemberWritesFake(state, { roles: { [BOB_LUSER]: role } });
      signInAs("teamAdminA");
      const { res } = await add({ oid: PEOPLE.bob.oid });
      await expectError(res, 409, "PRIVILEGED_TARGET");
      expect(writeCalls(state)).toHaveLength(0);
      const records = await memberAudit();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "litellm.member.add",
        result: "denied",
        code: "PRIVILEGED_TARGET",
        actor: CALLERS.teamAdminA.oid,
      });
    },
  );

  it("an internal_user_viewer target is not privileged (Allowlist: internal_user or internal_user_viewer)", async () => {
    installMemberWritesFake(state, {
      roles: { [BOB_LUSER]: "internal_user_viewer" },
    });
    signInAs("admin");
    expect((await add({ oid: PEOPLE.bob.oid })).res.status).toBe(201);
  });

  it.each([
    ["a person who is not a dashboard member of the team", PEOPLE.carol.oid],
    ["another team's member", CALLERS.memberB.oid],
    ["an unknown oid", "00000000-0000-4000-8000-00000000dead"],
  ])(
    "%s is 404 NOT_FOUND with no LiteLLM write (Members: only existing dashboard members; LT5)",
    async (_n, oid) => {
      signInAs("teamAdminA");
      await expectError((await add({ oid })).res, 404, "NOT_FOUND");
      expect(writeCalls(state)).toHaveLength(0);
    },
  );

  it.each([
    ["more than the team's max_budget of 100", { maxBudgetInTeam: 100.01 }],
    ["a negative budget", { maxBudgetInTeam: -1 }],
    [
      "a zero budget (LiteLLM reads 0 as blocked; B3 PositiveBudget)",
      { maxBudgetInTeam: 0 },
    ],
    ["a malformed duration", { budgetDuration: "forever" }],
    ["an unknown field (strict body)", { role: "admin" }],
    ["a client-supplied email", { email: "x@company.com" }],
  ])(
    "a body with %s is 400 BAD_REQUEST with no LiteLLM write (LT13; strict inputs)",
    async (_n, extra) => {
      signInAs("admin");
      const { res } = await add({ oid: PEOPLE.alice.oid, ...extra });
      await expectError(res, 400, "BAD_REQUEST");
      expect(writeCalls(state)).toHaveLength(0);
    },
  );

  it("the budget ceiling is inclusive: exactly the team's max_budget is allowed (LT13)", async () => {
    signInAs("admin");
    const { res } = await add({
      oid: PEOPLE.alice.oid,
      maxBudgetInTeam: 100,
    });
    expect(res.status).toBe(201);
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE with no LiteLLM call (LT11)", async () => {
    signInAs("admin");
    useEnv({ AUTH_ACCESS_MODE: "open" });
    await expectError(
      (await add({ oid: PEOPLE.alice.oid })).res,
      403,
      "OPERATION_UNAVAILABLE",
    );
    expect(state.fake.calls).toHaveLength(0);
  });

  it("addTeamMember is on by default (LD10) and a saved toggle off wins", async () => {
    signInAs("admin");
    expect((await add({ oid: PEOPLE.alice.oid })).res.status).toBe(201);
    await setToggles({ addTeamMember: false });
    await expectError(
      (await add({ oid: PEOPLE.bob.oid })).res,
      403,
      "OPERATION_DISABLED",
    );
  });
});
