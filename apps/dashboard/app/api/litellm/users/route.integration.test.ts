import {
  LiteLLMUserSearchResponseSchema,
  UsersListResponseSchema,
} from "@llm-usage-lens/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { putIdentityLink } from "@/lib/data/access/identity-links";
import { grantRole } from "@/lib/data/access/role-grants";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import type { FakeHandler } from "@/test/fakes/fake-litellm";
import {
  AUDIT_DAY,
  bodyOf,
  callsTo,
  installMemberWritesFake,
  memberWritesHandler,
  seedMemberPeople,
  send,
} from "@/test/support/litellm-member-writes-support";
import {
  PEOPLE,
  seedIdentity,
  seedMember,
} from "@/test/support/matrix-route-support";
import {
  LTEAM,
  enterProd,
  call,
  expectError,
  expectNoSentinels,
  installFake,
  setToggles,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
  useEnv,
} from "@/test/fakes/fake-litellm-views";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";

// Source: docs/specs/2026-11-10-litellm.md — "Reads" (searchUsers: search 2-100
// characters trimmed, page, page_size <= 25; for a Lead also team=<linked
// team>, once per linked team in scope; rows reduced to user_id, user_email,
// spend, max_budget, team ids filtered to the caller's scope), "Views by role
// (L3b)" (Scope), "API routes" (/api/litellm/users GET ?q=), LD22, LT21,
// Access Control "Enforcement" item 2, error codes, LD19, Rules 10.3, 60.23.
//
// Contract for the developer (.../users/route.ts, GET):
//   query: q (required, trimmed, 2-100 chars), page (default 1), pageSize (1-25,
//   default 25). Invalid -> 400 BAD_REQUEST (after the 403 check).
//   200 data = { users: [{ userId, email, spend, maxBudget,
//                          teams: [{ teamId, teamName }] }],
//                page, pageSize, enabledOperations: string[] }
//   `teams` are DASHBOARD teams (LiteLLM ids never surface), only linked teams
//   and, for a Lead, only teams in its scope. Rows are deduplicated by userId.
//   A Lead's rows with no team in scope are dropped (even if LiteLLM returned
//   them). Lead / org-admin / Admin / Auditor allowed; Viewer and no role 403
//   FORBIDDEN, before parsing and before any LiteLLM call.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupViewsSuite();
const get = async (query = "?q=company") => {
  stubLiteLLMEnv();
  const { GET } = await import("./route");
  return call(GET, `/api/litellm/users${query}`);
};
const listCalls = () => state.fake.calls.filter((c) => c.path === "/user/list");
const ids = (body: { data?: unknown }): string[] =>
  (body.data as { users: Array<{ userId: string }> }).users
    .map((u) => u.userId)
    .sort();

const ALL = [
  "a1@company.com",
  "ab@company.com",
  "b1@company.com",
  "c1@company.com",
  "lone@company.com",
  "mix@company.com",
  "uid-ta-0001", // email ta@company.com: search matches id or email (Views: Users)
];

describe("GET /api/litellm/users?q=", () => {
  it("401 without a session, no-store (Rule 10.3)", async () => {
    signInAs(null);
    const { res } = await get();
    await expectError(res, 401, "UNAUTHORIZED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each([
    ["orgAdmin", true],
    ["admin", true],
    ["auditor", true],
    ["teamAdminA", true],
    ["deptAdminEng", true],
    ["memberA", false],
    ["viewerNone", false],
    ["noRole", false],
  ] as Array<[CallerName | "noRole", boolean]>)(
    "%s -> allowed: %s (API routes; LT21: Viewer 403)",
    async (who, allowed) => {
      if (who === "noRole") await signInWithRoles([]);
      else signInAs(who);
      const { res, body } = await get();
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      if (allowed) {
        expect(res.status).toBe(200);
        expect(Array.isArray(body.data.users)).toBe(true);
      } else {
        await expectError(res, 403, "FORBIDDEN");
        expect(state.fake.calls).toHaveLength(0);
      }
    },
  );

  // M3 (D16a, LT-MI2): a call without `q` is the all-users list, for the
  // global readers only. It was a 403 when `q` was required; it is now the
  // missing-page 404 for a user, as for a Lead (see the list describe below).
  it("a Viewer with no q gets the list's 404, not 403, and no LiteLLM call (LT-MI2)", async () => {
    signInAs("memberA");
    const { res } = await get("");
    await expectError(res, 404, "NOT_FOUND");
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each(["org-admin", "Admin", "Auditor"] as const)(
    "%s searches the whole proxy: one call, no team filter (Reads: searchUsers)",
    async (label) => {
      signInAs(
        (
          {
            "org-admin": "orgAdmin",
            Admin: "admin",
            Auditor: "auditor",
          } as const
        )[label],
      );
      const { body } = await get("?q=%20company%20");
      expect(listCalls()).toHaveLength(1);
      const q = new URL(listCalls()[0]!.url).searchParams;
      expect(q.get("search")).toBe("company"); // trimmed
      expect(q.has("team")).toBe(false);
      expect(Number(q.get("page_size"))).toBeLessThanOrEqual(25);
      expect(ids(body)).toEqual(ALL);
    },
  );

  it("rows are reduced to the allowlisted fields and team ids are dashboard ids, never LiteLLM ids (reduction; LT1, LT9)", async () => {
    signInAs("admin");
    const { body, text } = await get("?q=mix");
    expect(body.data.users).toEqual([
      {
        userId: "mix@company.com",
        email: "mix@company.com",
        spend: 7,
        maxBudget: null,
        teams: [
          { teamId: "team-a", teamName: expect.any(String) },
          { teamId: "team-c", teamName: expect.any(String) },
        ],
      },
    ]);
    expectNoSentinels(body);
    for (const id of Object.values(LTEAM)) expect(text).not.toContain(id);
  });

  it("a Lead's search sends team=<linked team> once per team in scope and nothing for other teams (LT21)", async () => {
    signInAs("deptAdminEng");
    await get();
    const teams = listCalls()
      .map((c) => new URL(c.url).searchParams.get("team"))
      .sort();
    expect(teams).toEqual([LTEAM["team-a"], LTEAM["team-b"]].sort());
  });

  it("a team Lead's search is scoped to its one team, deduplicated, and shows only in-scope team ids (LT21)", async () => {
    signInAs("teamAdminA");
    const { body } = await get();
    expect(listCalls()).toHaveLength(1);
    expect(ids(body)).toEqual([
      "a1@company.com",
      "ab@company.com",
      "mix@company.com",
    ]);
    const mix = body.data.users.find(
      (u: { userId: string }) => u.userId === "mix@company.com",
    );
    expect(mix.teams.map((t: { teamId: string }) => t.teamId)).toEqual([
      "team-a",
    ]);
  });

  it("a department Lead's merged results list a user in two of its teams once (LT21)", async () => {
    signInAs("deptAdminEng");
    const { body } = await get();
    expect(ids(body)).toEqual([
      "a1@company.com",
      "ab@company.com",
      "b1@company.com",
      "mix@company.com",
    ]);
    const ab = body.data.users.find(
      (u: { userId: string }) => u.userId === "ab@company.com",
    );
    expect(ab.teams.map((t: { teamId: string }) => t.teamId).sort()).toEqual([
      "team-a",
      "team-b",
    ]);
  });

  it("a Lead never sees rows outside its teams even when LiteLLM ignores team= (LT21: filtered after the call)", async () => {
    installFake(state, { ignoreTeamFilter: true });
    signInAs("teamAdminA");
    const { body, text } = await get();
    expect(ids(body)).toEqual([
      "a1@company.com",
      "ab@company.com",
      "mix@company.com",
    ]);
    for (const out of [
      "b1@company.com",
      "c1@company.com",
      "lone@company.com",
    ]) {
      expect(text).not.toContain(out);
    }
  });

  it.each([
    ["1 character", "?q=a"],
    ["1 character after trimming", "?q=%20a%20"],
    ["101 characters", `?q=${"a".repeat(101)}`],
    ["pageSize 26", "?q=company&pageSize=26"],
    ["page 0", "?q=company&page=0"],
  ])(
    "q/paging %s is 400 BAD_REQUEST, no LiteLLM call (Reads: searchUsers bounds)",
    async (_n, query) => {
      signInAs("admin");
      const { res } = await get(query);
      await expectError(res, 400, "BAD_REQUEST");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("forwards page and pageSize to LiteLLM (Reads: searchUsers)", async () => {
    signInAs("admin");
    await get("?q=company&page=2&pageSize=10");
    const q = new URL(listCalls()[0]!.url).searchParams;
    expect(q.get("page")).toBe("2");
    expect(q.get("page_size")).toBe("10");
  });

  it("a disabled searchUsers is 403 OPERATION_DISABLED before any LiteLLM call (LD19)", async () => {
    await setToggles({ searchUsers: false });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE without upstream detail (error codes; LT12)", async () => {
    installFake(state, { outage: true });
    signInAs("admin");
    const { res, text } = await get();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE (LT11)", async () => {
    useEnv({ AUTH_ACCESS_MODE: "open" });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
  });
});

// Source: docs/specs/2026-11-10-litellm.md LD23 (per-user LiteLLM cost obeys the
// Organisation cap), LT21; Access Control - "Organisation cap" (prod, until the
// per-user approval is recorded every caller sees per-user counts and
// identities only), T16. Decision: capped rows OMIT `spend` and `maxBudget`
// (absent keys, not null/0, so no number can be mistaken for "no spend").
describe("GET /api/litellm/users?q= - Organisation cap (LD23, T16)", () => {
  const CAPPED_CALLERS = [
    "admin",
    "orgAdmin",
    "auditor",
    "teamAdminA",
    "deptAdminEng",
  ] as const;

  it.each(CAPPED_CALLERS)(
    "%s in prod without the approval gets identities and teams but no spend or budget",
    async (who) => {
      await enterProd();
      signInAs(who);
      const { res, body } = await get("?q=ab");
      expect(res.status).toBe(200);
      expect(ids(body)).toEqual(["ab@company.com"]);
      const row = body.data.users[0];
      expect(row.email).toBe("ab@company.com");
      expect(row.teams.length).toBeGreaterThan(0);
      expect(row).not.toHaveProperty("spend");
      expect(row).not.toHaveProperty("maxBudget");
    },
  );

  it("with the approval recorded, spend and budget are present again (LD23: reversible)", async () => {
    await enterProd({ approved: true });
    signInAs("teamAdminA");
    const { body } = await get("?q=ab");
    expect(body.data.users[0]).toMatchObject({ spend: 6, maxBudget: 10 });
  });

  it("outside prod the cap does not apply (dev keeps per-user cost)", async () => {
    signInAs("admin");
    const { body } = await get("?q=ab");
    expect(body.data.users[0]).toMatchObject({ spend: 6, maxBudget: 10 });
  });
});

// Source: docs/specs/2026-11-10-litellm.md - "Reads" searchUsers row (a Lead's
// merged results are capped at 25 rows per page), LT21. Decision: a Lead's
// per-team calls forward `page` and `pageSize` (page N of each team's list);
// the de-duplicated merge is sorted by email (ascending) and cut to `pageSize`
// rows, so one page never exceeds 25 rows however many teams are linked. Users
// cut from a page are reached by refining the search (stated limit, no
// hasMore flag in v1).
describe("GET /api/litellm/users?q= - Lead merged page cap (searchUsers)", () => {
  const rows = (prefix: string, team: string) =>
    Array.from({ length: 30 }, (_, i) => {
      const id = `${prefix}${String(i).padStart(2, "0")}@company.com`;
      return {
        user_id: id,
        user_email: id,
        spend: 1,
        max_budget: null,
        teams: [team],
      };
    });
  const bulk = () => {
    installFake(state, {
      extraUsers: [
        ...rows("bulka", LTEAM["team-a"]),
        ...rows("bulkb", LTEAM["team-b"]),
      ],
    });
  };
  const idsOf = (body: { data?: unknown }) =>
    (body.data as { users: Array<{ userId: string }> }).users.map(
      (u) => u.userId,
    );

  it("a Lead with two linked teams gets at most 25 rows on page 1, sorted by email", async () => {
    bulk();
    signInAs("deptAdminEng");
    const { body } = await get("?q=bulk");
    const list = idsOf(body);
    expect(list).toHaveLength(25);
    expect(list).toEqual([...list].sort());
    expect(list[0]).toBe("bulka00@company.com");
  });

  it("page 2 is page 2 of each team's list, merged, sorted and capped (rows 26-30 of each team)", async () => {
    bulk();
    signInAs("deptAdminEng");
    const { body } = await get("?q=bulk&page=2");
    expect(body.data.page).toBe(2);
    expect(idsOf(body)).toEqual([
      ...[25, 26, 27, 28, 29].map((n) => `bulka${n}@company.com`),
      ...[25, 26, 27, 28, 29].map((n) => `bulkb${n}@company.com`),
    ]);
    for (const c of listCalls()) {
      expect(new URL(c.url).searchParams.get("page")).toBe("2");
    }
  });

  it("a smaller pageSize caps the merged list at that size", async () => {
    bulk();
    signInAs("deptAdminEng");
    const { body } = await get("?q=bulk&pageSize=10");
    expect(idsOf(body)).toEqual(
      Array.from(
        { length: 10 },
        (_, i) => `bulka${String(i).padStart(2, "0")}@company.com`,
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// M3: the LiteLLM users tab list (management improvements D16a).
// Source: docs/specs/2026-11-10-litellm.md - Reads `searchUsers` ("search
// optional ... without it the call lists LiteLLM's users page by page, page_size
// <= 25", amended D16a), "API routes" (/api/litellm/users GET), "Views as
// Management routes" (D16a reads and the LD34 call budget: all users is one
// call; members of one team at most 26 a page; a team above 200 members is 422
// with no call; a cap hit is 503, never a partial list), LD23 (Organisation
// cap), LD19, LT21, LT-MI2, LT25; Design System - "LiteLLM users tab" and
// "User link states".
// ---------------------------------------------------------------------------

const parseList = (body: { data?: unknown }) =>
  UsersListResponseSchema.parse(body.data);
const rowsOf = (body: { data?: unknown }) => parseList(body).users;

const bulkUsers = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const id = `bulk${String(i).padStart(2, "0")}@company.com`;
    return {
      user_id: id,
      user_email: id,
      spend: 1,
      max_budget: null,
      teams: [],
    };
  });

describe("GET /api/litellm/users (no q): all users, one page on the server (D16a, LT-MI2)", () => {
  it("401 without a session (Rule 10.3)", async () => {
    signInAs(null);
    const { res } = await get("");
    await expectError(res, 401, "UNAUTHORIZED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each(["orgAdmin", "admin", "auditor"] as const)(
    "%s lists users with a single /user/list call: no search, no team, page_size 25 (LT-MI2)",
    async (who) => {
      signInAs(who);
      const { res, body } = await get("");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(state.fake.calls).toHaveLength(1);
      const q = new URL(listCalls()[0]!.url).searchParams;
      expect(q.has("search")).toBe(false);
      expect(q.has("team")).toBe(false);
      expect(q.get("page")).toBe("1");
      expect(q.get("page_size")).toBe("25");
      expect(parseList(body).users).toHaveLength(7);
    },
  );

  it.each(["teamAdminA", "deptAdminEng", "memberA", "viewerNone"] as const)(
    "%s (a Lead or a Viewer) gets 404 for the list, with no LiteLLM call (LT-MI2)",
    async (who) => {
      signInAs(who);
      const { res } = await get("");
      await expectError(res, 404, "NOT_FOUND");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("pages on the server: 25 rows a page, the page is forwarded, and each request makes exactly one /user/list call (never loads everything)", async () => {
    installFake(state, { extraUsers: bulkUsers(60) }); // 67 users in all
    signInAs("admin");
    const seen: string[] = [];
    for (const [page, expectedRows, hasMore] of [
      [1, 25, true],
      [2, 25, true],
      [3, 17, false],
    ] as const) {
      state.fake.calls.length = 0;
      const { body } = await get(`?page=${page}&pageSize=25`);
      const data = parseList(body);
      expect(data.users).toHaveLength(expectedRows);
      expect(data.page).toBe(page);
      expect(data.hasMore).toBe(hasMore);
      expect(state.fake.calls).toHaveLength(1);
      expect(new URL(listCalls()[0]!.url).searchParams.get("page")).toBe(
        String(page),
      );
      seen.push(...data.users.map((r) => r.key));
    }
    expect(new Set(seen).size).toBe(67);
  });

  it("a smaller pageSize is honoured and forwarded as page_size", async () => {
    signInAs("admin");
    const { body } = await get("?pageSize=3");
    expect(rowsOf(body)).toHaveLength(3);
    expect(new URL(listCalls()[0]!.url).searchParams.get("page_size")).toBe(
      "3",
    );
  });

  it.each([
    ["pageSize 26", "?pageSize=26"],
    ["pageSize 0", "?pageSize=0"],
    ["page 0", "?page=0"],
    ["a 1 character q", "?q=a"],
  ])(
    "%s is 400 BAD_REQUEST with no LiteLLM call (Reads: searchUsers bounds)",
    async (_n, query) => {
      signInAs("admin");
      const { res } = await get(query);
      await expectError(res, 400, "BAD_REQUEST");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("a user claimed by an app user is Linked with that person; every other row is unlinked with no app user (Design System - User link states)", async () => {
    signInAs("admin");
    const { body } = await get("");
    const rows = rowsOf(body);
    const linked = rows.find((r) => r.key === "a1@company.com");
    expect(linked).toMatchObject({
      linkState: "linked",
      appUser: { oid: CALLERS.memberA.oid },
      litellmUser: { userId: "a1@company.com", email: "a1@company.com" },
    });
    for (const r of rows.filter(
      (r) => r.key !== "a1@company.com" && r.key !== "b1@company.com",
    )) {
      expect(r.linkState).toBe("unlinked");
      expect(r.appUser).toBeNull();
    }
  });

  it("rows are reduced: no loose upstream field and no LiteLLM team id leaves the server (LT1, LT9)", async () => {
    signInAs("admin");
    const { body, text } = await get("");
    expectNoSentinels(body);
    for (const id of Object.values(LTEAM)) expect(text).not.toContain(id);
  });

  it("outside prod a row carries spend and budget (the cap does not apply)", async () => {
    signInAs("admin");
    const { body } = await get("");
    const ab = rowsOf(body).find((r) => r.key === "ab@company.com");
    expect(ab?.litellmUser).toMatchObject({ spend: 6, maxBudget: 10 });
  });

  it.each(["admin", "orgAdmin", "auditor"] as const)(
    "%s in prod without the per-user approval gets no spend or budget on any row (LD23, T16)",
    async (who) => {
      await enterProd();
      signInAs(who);
      const { res, body } = await get("");
      expect(res.status).toBe(200);
      const rows = rowsOf(body);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.litellmUser).not.toHaveProperty("spend");
        expect(r.litellmUser).not.toHaveProperty("maxBudget");
      }
    },
  );

  it("with the approval recorded, prod rows carry spend again (LD23: reversible)", async () => {
    await enterProd({ approved: true });
    signInAs("admin");
    const { body } = await get("");
    expect(
      rowsOf(body).find((r) => r.key === "ab@company.com")?.litellmUser,
    ).toMatchObject({ spend: 6 });
  });

  // LiteLLM spec - Views as Management routes, D16a decision as amended by
  // LF1 D-LF1 and D-LF4 (2026-11-18): `q` with include=links no longer returns
  // the list shape; the search has its own response schema and the tab's
  // table has no link-state column.
  it("q with include=links answers the search shape like any q: no link states (D-LF1, D-LF4)", async () => {
    signInAs("admin");
    const { res, body } = await get("?q=a1&include=links");
    expect(res.status).toBe(200);
    expect(new URL(listCalls()[0]!.url).searchParams.get("search")).toBe("a1");
    expect(LiteLLMUserSearchResponseSchema.safeParse(body.data).success).toBe(
      true,
    );
    expect(UsersListResponseSchema.safeParse(body.data).success).toBe(false);
    expect(body.data.users[0]).not.toHaveProperty("linkState");
  });

  // The tab sends ?page&pageSize&q. Item 3 (2026-11-18): the client parsed this
  // answer with the list schema and failed on users[0].key, linkState,
  // appUser, litellmUser and hasMore. The route's answer is the search shape,
  // and its exported schema is the one the client must parse it with.
  it("the tab's search request (?page&pageSize&q) answers the search shape that LiteLLMUserSearchResponseSchema parses (D-LF1, T-LF2)", async () => {
    signInAs("admin");
    const { res, body } = await get("?page=1&pageSize=25&q=ab");
    expect(res.status).toBe(200);
    expect(LiteLLMUserSearchResponseSchema.safeParse(body.data).success).toBe(
      true,
    );
    expect(UsersListResponseSchema.safeParse(body.data).success).toBe(false);
  });

  it.each([
    ["admin", true],
    ["orgAdmin", true],
    ["auditor", false],
  ] as const)(
    "%s's search answer carries mayLink %s, so a search row can offer Reset spend only to who may write (RS2, D-LF1)",
    async (who, expected) => {
      signInAs(who);
      const { body } = await get("?q=ab");
      expect(LiteLLMUserSearchResponseSchema.parse(body.data).mayLink).toBe(
        expected,
      );
    },
  );

  // Design System users tab LF1 decision (d), RS2 "Reset any LiteLLM user": a
  // search row has no oid, so the answer names the caller's own LiteLLM user
  // (from their stored identity link, per request) for the client to hide
  // Reset spend on it. null when the caller has no link.
  it("the search answer carries callerLitellmUserId: the caller's linked LiteLLM user, null without a link (LF1 (d), RS2)", async () => {
    signInAs("admin");
    const unlinked = await get("?q=ab");
    expect(
      (unlinked.body.data as { callerLitellmUserId?: unknown })
        .callerLitellmUserId ?? null,
    ).toBeNull();
    ok(
      await putIdentityLink(
        {
          oid: CALLERS.admin.oid,
          usageIdentities: [CALLERS.admin.email],
          aliases: [],
          litellmUserId: "ab@company.com",
          version: null,
        },
        ctxAt(undefined, "req-own-litellm"),
      ),
    );
    const linked = await get("?q=ab");
    expect(
      (linked.body.data as { callerLitellmUserId?: unknown })
        .callerLitellmUserId,
    ).toBe("ab@company.com");
  });

  it("a Lead's search still drops rows outside its teams after the LiteLLM call and carries no cost under the cap, in the exported schema (T-LF2, LT21, LD23)", async () => {
    await enterProd();
    installFake(state, { ignoreTeamFilter: true });
    signInAs("teamAdminA");
    const { res, body } = await get("?q=company");
    expect(res.status).toBe(200);
    const parsed = LiteLLMUserSearchResponseSchema.parse(body.data);
    expect(parsed.users.map((u) => u.userId).sort()).toEqual([
      "a1@company.com",
      "ab@company.com",
      "mix@company.com",
    ]);
    for (const row of parsed.users) {
      expect(row).not.toHaveProperty("spend");
      expect(row).not.toHaveProperty("maxBudget");
    }
  });

  it("a disabled searchUsers is 403 OPERATION_DISABLED before any LiteLLM call (LD19)", async () => {
    await setToggles({ searchUsers: false });
    signInAs("admin");
    const { res } = await get("");
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE with no partial list and no upstream detail (LD35, LT12)", async () => {
    installFake(state, { outage: true });
    signInAs("admin");
    const { res, text } = await get("");
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
  });

  it("a stored link for a LiteLLM user is shown with the person's name and email, not their identity internals", async () => {
    signInAs("admin");
    await seedIdentity(CALLERS.memberA.oid, {
      email: "a1@company.com",
      name: "Member A",
    });
    const { body, text } = await get("");
    const row = rowsOf(body).find((r) => r.key === "a1@company.com");
    expect(row?.appUser).toMatchObject({
      displayName: "Member A",
      email: "a1@company.com",
    });
    expect(text).not.toContain("failedAttempts");
    expect(text).not.toContain("lockedUntil");
  });
});

// Coordinator ruling F1 (M3): the list tells the page whether the caller may
// write a link, so the page shows link controls only to callers the PUT/DELETE
// link routes accept. `mayLink` is computed per request, uncached, from the
// effective roles (claim plus stored RoleGrant; Rule 50.4, Rule 60.10), with
// the same check as `permitAdminOrOrgAdmin` (LD24; Access Control - LiteLLM
// user links: internal-admin, internal-org-admin). `/api/me` is unchanged.
describe("GET /api/litellm/users: mayLink (F1; Rule 50.4, Rule 60.10)", () => {
  const mayLinkOf = (body: { data?: unknown }) =>
    (body.data as { mayLink?: unknown }).mayLink;

  it.each([
    ["admin", true],
    ["orgAdmin", true],
    ["auditor", false],
  ] as const)(
    "%s by claim gets mayLink: %s on the list",
    async (who, expected) => {
      signInAs(who);
      const { res, body } = await get("");
      expect(res.status).toBe(200);
      expect(mayLinkOf(body)).toBe(expected);
    },
  );

  it("an org-admin whose role comes only from a stored in-app grant gets mayLink: true (effective roles, not the token claim)", async () => {
    await signInWithRoles([]);
    ok(
      await grantRole(
        {
          oid: "00000000-0000-4000-8000-0000000009ff",
          role: "internal-org-admin",
          reason: "mayLink",
        },
        ctxAt(),
      ),
    );
    const { res, body } = await get("");
    expect(res.status).toBe(200);
    expect(mayLinkOf(body)).toBe(true);
  });

  it("the same flag rides the team list and the search", async () => {
    await seedMemberPeople();
    installMemberWritesFake(state);
    for (const [who, expected] of [
      ["orgAdmin", true],
      ["auditor", false],
    ] as const) {
      signInAs(who);
      const team = await get("?team=team-a");
      expect(team.res.status).toBe(200);
      expect(mayLinkOf(team.body)).toBe(expected);
    }
    signInAs("auditor");
    const search = await get("?q=company");
    expect(mayLinkOf(search.body)).toBe(false);
  });

  it("is read per request: a grant stored between two calls flips the flag, never a cached answer", async () => {
    await signInWithRoles(["internal-auditor"]);
    expect(mayLinkOf((await get("")).body)).toBe(false);
    ok(
      await grantRole(
        {
          oid: "00000000-0000-4000-8000-0000000009ff",
          role: "internal-org-admin",
          reason: "mayLink",
        },
        ctxAt(),
      ),
    );
    expect(mayLinkOf((await get("")).body)).toBe(true);
  });

  it.each(["teamAdminA", "deptAdminEng", "memberA"] as const)(
    "%s gets the list's 404, so no flag at all (LT-MI2)",
    async (who) => {
      signInAs(who);
      const { res, body } = await get("");
      await expectError(res, 404, "NOT_FOUND");
      expect(JSON.stringify(body)).not.toContain("mayLink");
    },
  );
});

describe("GET /api/litellm/users?team=: members of one team (D16a, LD34, LT-MI2)", () => {
  beforeEach(async () => {
    await seedMemberPeople();
    await seedIdentity(CALLERS.memberA.oid, {
      email: "a1@company.com",
      name: "Member A",
    });
    installMemberWritesFake(state);
  });

  const orphanFake = (): FakeHandler => {
    const base = memberWritesHandler();
    return (call, attempt) => {
      const reply = base(call, attempt);
      if (typeof reply === "string" || call.path !== "/team/info") return reply;
      const b = reply.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      return {
        status: reply.status,
        body: {
          ...b,
          team_info: {
            ...b.team_info,
            members_with_roles: [
              ...b.team_info.members_with_roles,
              {
                user_id: "orphan@company.com",
                user_email: "orphan@company.com",
                role: "user",
              },
            ],
          },
          team_memberships: [
            ...b.team_memberships,
            {
              user_id: "orphan@company.com",
              team_id: b.team_id,
              spend: 2,
              budget_id: "b2",
              litellm_budget_table: { max_budget: 5 },
            },
          ],
        },
      };
    };
  };
  const useOrphans = () => {
    state.fake = createFakeLiteLLM(orphanFake());
    vi.stubGlobal("fetch", state.fake.fetch);
  };
  const byOid = (body: { data?: unknown }, oid: string) =>
    rowsOf(body).find((r) => r.appUser?.oid === oid);

  it("lists exactly the app team's members (the affiliations), nobody from another team", async () => {
    signInAs("admin");
    const { res, body, text } = await get("?team=team-a");
    expect(res.status).toBe(200);
    const oids = rowsOf(body).flatMap((r) =>
      r.appUser ? [r.appUser.oid] : [],
    );
    expect(oids.sort()).toEqual(
      [CALLERS.memberA.oid, PEOPLE.alice.oid, PEOPLE.bob.oid].sort(),
    );
    expect(text).not.toContain(CALLERS.memberB.oid);
    expect(text).not.toContain("b1@company.com");
  });

  it("each member has the LiteLLM user from the stored link, else the email lookup: Linked, Match found, or none (Design System - User link states)", async () => {
    signInAs("admin");
    const { body } = await get("?team=team-a");
    expect(byOid(body, CALLERS.memberA.oid)).toMatchObject({
      linkState: "linked",
      litellmUser: { userId: "a1@company.com" },
    });
    expect(byOid(body, PEOPLE.bob.oid)).toMatchObject({
      linkState: "match",
      litellmUser: { userId: "bob@company.com" },
    });
    expect(byOid(body, PEOPLE.alice.oid)).toMatchObject({
      linkState: "none",
      litellmUser: null,
    });
  });

  it("a member with no LiteLLM user is 'not in LiteLLM', never $0: no spend field at all (Design System - LiteLLM users tab)", async () => {
    signInAs("admin");
    const { body } = await get("?team=team-a");
    const row = byOid(body, PEOPLE.alice.oid);
    expect(row?.litellmUser).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/spend|maxBudget/);
  });

  it("an email lookup that finds only another person's email is not a match (LT24)", async () => {
    // alice's lookup answers a row for someone else: she stays 'none'.
    const base = memberWritesHandler();
    state.fake = createFakeLiteLLM((call, attempt) =>
      call.path === "/user/list" &&
      new URL(call.url).searchParams.get("user_email") === PEOPLE.alice.email
        ? {
            status: 200,
            body: {
              users: [
                { user_id: "zed@company.com", user_email: "zed@company.com" },
              ],
              total: 1,
              page: 1,
              page_size: 25,
              total_pages: 1,
            },
          }
        : base(call, attempt),
    );
    vi.stubGlobal("fetch", state.fake.fetch);
    signInAs("admin");
    const { body } = await get("?team=team-a");
    expect(byOid(body, PEOPLE.alice.oid)?.linkState).toBe("none");
  });

  it("for a linked team the LiteLLM team's own members also appear: an orphan is listed as unlinked with no app user (Design System - orphaned LiteLLM member)", async () => {
    useOrphans();
    signInAs("admin");
    const { body } = await get("?team=team-a");
    const orphan = rowsOf(body).find((r) => r.key === "orphan@company.com");
    expect(orphan).toMatchObject({
      linkState: "unlinked",
      appUser: null,
      litellmUser: { userId: "orphan@company.com", spend: 2 },
    });
    // The claimed member is not listed twice.
    expect(
      rowsOf(body).filter((r) => r.litellmUser?.userId === "a1@company.com"),
    ).toHaveLength(1);
  });

  it("an unlinked team lists its members and reads no LiteLLM team (App Teams spec - Teams without a link)", async () => {
    await seedIdentity(PEOPLE.carol.oid, {
      email: PEOPLE.carol.email,
      name: "Carol",
    });
    await seedMember(PEOPLE.carol.oid, "team-u");
    signInAs("admin");
    const { body } = await get("?team=team-u");
    expect(rowsOf(body).map((r) => r.appUser?.oid)).toEqual([PEOPLE.carol.oid]);
    expect(callsTo(state, "GET /team/info")).toHaveLength(0);
  });

  it("call budget for a small team: one getTeam plus one lookup per member without a stored link (LD34)", async () => {
    signInAs("admin");
    await get("?team=team-a");
    expect(callsTo(state, "GET /team/info")).toHaveLength(1);
    const lookups = listCalls().map((c) =>
      new URL(c.url).searchParams.get("user_email"),
    );
    expect(lookups.sort()).toEqual([PEOPLE.alice.email, PEOPLE.bob.email]);
    expect(state.fake.calls).toHaveLength(3);
  });

  it("a team of 30 pages 25 a page and a page makes at most 26 LiteLLM calls (LD34)", async () => {
    for (let n = 0; n < 30; n += 1) {
      const id = `00000000-0000-4000-8000-0000000007${String(n).padStart(2, "0")}`;
      await seedIdentity(id, {
        email: `bulkmember${n}@company.com`,
        name: `Bulk ${String(n).padStart(2, "0")}`,
      });
      await seedMember(id, "team-u");
    }
    signInAs("admin");
    const first = await get("?team=team-u&page=1&pageSize=25");
    expect(rowsOf(first.body)).toHaveLength(25);
    expect(parseList(first.body).hasMore).toBe(true);
    expect(parseList(first.body).total).toBe(30);
    expect(state.fake.calls.length).toBeLessThanOrEqual(26);
    state.fake.calls.length = 0;
    const second = await get("?team=team-u&page=2&pageSize=25");
    expect(rowsOf(second.body)).toHaveLength(5);
    expect(parseList(second.body).hasMore).toBe(false);
    expect(state.fake.calls.length).toBeLessThanOrEqual(26);
  });

  it("a team above 200 members is 422 TOO_MANY_MEMBERS with no LiteLLM call (LD34, LT25)", async () => {
    const ids = Array.from(
      { length: 201 },
      (_, n) =>
        `00000000-0000-4000-8000-0000000009${String(n).padStart(3, "0")}`,
    );
    for (let i = 0; i < ids.length; i += 25) {
      await Promise.all(
        ids.slice(i, i + 25).map((id) => seedMember(id, "team-u")),
      );
    }
    signInAs("admin");
    const { res } = await get("?team=team-u");
    await expectError(res, 422, "TOO_MANY_MEMBERS");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("q narrows the members of the team by name or email (Design System - LiteLLM users tab: the search narrows either filter)", async () => {
    signInAs("admin");
    const { body } = await get("?team=team-a&q=bob");
    expect(rowsOf(body).map((r) => r.appUser?.oid)).toEqual([PEOPLE.bob.oid]);
  });

  it.each(["teamAdminA", "deptAdminEng", "memberA", "viewerNone"] as const)(
    "%s gets 404 for a team's member list, even for its own team, with no LiteLLM call (LT-MI2: a Lead or a user gets 404)",
    async (who) => {
      signInAs(who);
      const { res } = await get("?team=team-a");
      await expectError(res, 404, "NOT_FOUND");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("an unknown team is the missing-team 404 and an over-long or control-character team id is 400 (Data Model - API Routes: ids are 1-128 characters, no control characters), all with no LiteLLM call (LT23)", async () => {
    signInAs("admin");
    await expectError((await get("?team=no-such-team")).res, 404, "NOT_FOUND");
    await expectError(
      (await get(`?team=${"a".repeat(129)}`)).res,
      400,
      "BAD_REQUEST",
    );
    await expectError((await get("?team=a%07b")).res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("per-user cost is hidden under the Organisation cap, for lookups and for the team's own members (LD23)", async () => {
    await enterProd();
    useOrphans();
    signInAs("admin");
    const { res, body } = await get("?team=team-a");
    expect(res.status).toBe(200);
    for (const r of rowsOf(body)) {
      if (r.litellmUser) {
        expect(r.litellmUser).not.toHaveProperty("spend");
        expect(r.litellmUser).not.toHaveProperty("maxBudget");
      }
    }
    expect(rowsOf(body).some((r) => r.key === "orphan@company.com")).toBe(true);
  });

  it("outside prod a member's spend is the LiteLLM team membership spend (Design System - spend and budget columns)", async () => {
    signInAs("admin");
    const { body } = await get("?team=team-a");
    expect(byOid(body, CALLERS.memberA.oid)?.litellmUser).toMatchObject({
      spend: 3.25,
    });
  });

  it("a failed LiteLLM read fails the request: 503, no partial list (LD35, LT25)", async () => {
    installFake(state, { outage: true });
    signInAs("admin");
    const { res, text } = await get("?team=team-a");
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain(PEOPLE.alice.email);
  });

  it("a disabled findUserByEmail is 403 OPERATION_DISABLED before any call; a disabled getTeam only blocks a linked team (LD19)", async () => {
    await setToggles({ findUserByEmail: false });
    signInAs("admin");
    await expectError(
      (await get("?team=team-a")).res,
      403,
      "OPERATION_DISABLED",
    );
    expect(state.fake.calls).toHaveLength(0);
    await setToggles({ getTeam: false });
    await expectError(
      (await get("?team=team-a")).res,
      403,
      "OPERATION_DISABLED",
    );
    expect(state.fake.calls).toHaveLength(0);
    expect((await get("?team=team-u")).res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/litellm/users: create a LiteLLM user for an app identity and link it.
// Source: docs/specs/2026-11-10-litellm.md - Writes `createUser` and the
// paragraph after it, "API routes" (POST /api/litellm/users: Admin, org-admin;
// OSS only; own oid 403 with one denied record after parsing), LT-MI1, LT17,
// LD14 (litellm-changed-by); Access Control - "LiteLLM user links", T-MI1.
// ---------------------------------------------------------------------------

describe("POST /api/litellm/users (create and link)", () => {
  beforeEach(async () => {
    await seedMemberPeople();
    installMemberWritesFake(state);
  });

  const post = async (body: unknown) => {
    stubLiteLLMEnv();
    const { POST } = await import("./route");
    return send(POST, {
      method: "POST",
      path: "/api/litellm/users",
      params: {},
      body,
    });
  };
  const linkOf = async (oid: string) => {
    const { getIdentityLink } =
      await import("@/lib/data/access/identity-links");
    return getIdentityLink(oid);
  };
  const ownerOf = async (litellmUserId: string) => {
    const { getLiteLLMUserOwner } =
      await import("@/lib/data/access/identity-links");
    return getLiteLLMUserOwner(litellmUserId);
  };
  const audit = async () => {
    const { listAuditRecords } = await import("@/lib/data/access/audit");
    return listAuditRecords(AUDIT_DAY);
  };
  const create = { oid: PEOPLE.alice.oid };

  it("401 without a session (Rule 10.3)", async () => {
    signInAs(null);
    const { res } = await post(create);
    await expectError(res, 401, "UNAUTHORIZED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each(["admin", "orgAdmin"] as const)(
    "%s creates the LiteLLM user and links it: 201, the body is exactly the addTeamMember user body, auto_create_key false (LT-MI1, LT17)",
    async (who) => {
      signInAs(who);
      const { res, body, text } = await post(create);
      expect(res.status).toBe(201);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(body.data).toMatchObject({
        oid: PEOPLE.alice.oid,
        litellmUserId: PEOPLE.alice.email,
        created: true,
      });
      expect(callsTo(state, "GET /user/list")).toHaveLength(1);
      const created = callsTo(state, "POST /user/new");
      expect(created).toHaveLength(1);
      expect(bodyOf(created[0])).toEqual({
        user_id: PEOPLE.alice.email,
        user_email: PEOPLE.alice.email,
        user_role: "internal_user",
        auto_create_key: false,
        send_invite_email: false,
      });
      expect(created[0]!.headers["litellm-changed-by"]).toMatch(
        /^llm-usage-lens:/,
      );
      expect(text).not.toContain("sk-AUTOCREATED-TRAP");
      expect((await linkOf(PEOPLE.alice.oid))?.litellmUserId).toBe(
        PEOPLE.alice.email,
      );
      expect(await ownerOf(PEOPLE.alice.email)).toBe(PEOPLE.alice.oid);
    },
  );

  it("the body comes from the server-held verified email, lower-cased, never from the request (LT-MI1)", async () => {
    await seedIdentity(PEOPLE.carol.oid, { email: "Carol.Mixed@Company.com" });
    signInAs("admin");
    await post({ oid: PEOPLE.carol.oid });
    expect(bodyOf(callsTo(state, "POST /user/new")[0])).toMatchObject({
      user_id: "carol.mixed@company.com",
      user_email: "carol.mixed@company.com",
    });
  });

  it("audits the creation and the link in the request, without the auto-created key (Access Control - Audit log; LT17)", async () => {
    signInAs("admin");
    await post(create);
    const records = await audit();
    const made = records.filter((r) => r.action === "litellm.user.create");
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({
      result: "success",
      actor: CALLERS.admin.oid,
      target: { type: "litellm-user", id: PEOPLE.alice.email },
    });
    const linked = records.filter(
      (r) => r.action === "identity.litellm-link.set",
    );
    expect(linked).toHaveLength(1);
    expect(JSON.stringify(linked[0])).toContain(PEOPLE.alice.oid);
    expect(JSON.stringify(linked[0])).toContain(PEOPLE.alice.email);
    expect(JSON.stringify(records)).not.toContain("sk-AUTOCREATED-TRAP");
  });

  it("Enterprise refuses: 403 OPERATION_UNAVAILABLE, no LiteLLM call at all, nothing linked (LT-MI1, LT16)", async () => {
    await enterProd();
    signInAs("admin");
    const { res } = await post(create);
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
    expect(state.fake.calls).toHaveLength(0);
    expect(await linkOf(PEOPLE.alice.oid)).toBeFalsy();
  });

  it("a disabled createUser toggle is 403 OPERATION_DISABLED before any call (LD19; toggle default is on)", async () => {
    await setToggles({ createUser: false });
    signInAs("admin");
    const { res } = await post(create);
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a user already in LiteLLM under that email is linked, never created twice (createUser: findUserByEmail miss first; retry finds it)", async () => {
    signInAs("admin");
    const { res, body } = await post({ oid: PEOPLE.bob.oid });
    expect([200, 201]).toContain(res.status);
    expect(body.data).toMatchObject({
      litellmUserId: PEOPLE.bob.email,
      created: false,
    });
    expect(callsTo(state, "POST /user/new")).toHaveLength(0);
    expect(await ownerOf(PEOPLE.bob.email)).toBe(PEOPLE.bob.oid);
  });

  it.each(["proxy_admin", "proxy_admin_viewer"])(
    "a %s user found by email is refused: 409 PRIVILEGED_TARGET, no creation, no link (T-MI1, LT-MI1)",
    async (role) => {
      installMemberWritesFake(state, { roles: { [PEOPLE.bob.email]: role } });
      signInAs("admin");
      const { res } = await post({ oid: PEOPLE.bob.oid });
      await expectError(res, 409, "PRIVILEGED_TARGET");
      expect(callsTo(state, "POST /user/new")).toHaveLength(0);
      expect(await linkOf(PEOPLE.bob.oid)).toBeFalsy();
      expect(await ownerOf(PEOPLE.bob.email)).toBeFalsy();
    },
  );

  it("a LiteLLM user already claimed by another app user is 409 CONFLICT, no second claim (T-MI1: one-to-one)", async () => {
    // Dave's verified email is a1@company.com, claimed by member A.
    signInAs("admin");
    const { res } = await post({ oid: PEOPLE.dave.oid });
    await expectError(res, 409, "CONFLICT");
    expect(callsTo(state, "POST /user/new")).toHaveLength(0);
    expect(await ownerOf("a1@company.com")).toBe(CALLERS.memberA.oid);
  });

  it("an identity that already has a LiteLLM link is 409 CONFLICT before any LiteLLM call", async () => {
    signInAs("admin");
    const { res } = await post({ oid: CALLERS.memberA.oid });
    expect([404, 409]).toContain(res.status);
    expect(state.fake.calls).toHaveLength(0);
  });

  it("an identity with no verified email is 409 and an unknown identity is the same 404 as a missing one, both without a call (LT-MI1)", async () => {
    signInAs("admin");
    const unknown = await post({ oid: "00000000-0000-4000-8000-00000000dead" });
    await expectError(unknown.res, 404, "NOT_FOUND");
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each([
    ["no oid", {}],
    ["an empty oid", { oid: "" }],
    [
      "a client-chosen email",
      { oid: PEOPLE.alice.oid, email: "evil@company.com" },
    ],
    ["a client-chosen user id", { oid: PEOPLE.alice.oid, userId: "x" }],
  ])(
    "%s is 400 BAD_REQUEST with no LiteLLM call (the email is never client-supplied)",
    async (_n, payload) => {
      signInAs("admin");
      const { res } = await post(payload);
      await expectError(res, 400, "BAD_REQUEST");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  // Role x operation (security matrix): only admin and org-admin write; the
  // refusal comes before parsing (an invalid body still answers 403) and
  // touches neither LiteLLM nor the link store. T-MI1: auditor and Lead 403.
  it.each([
    ["auditor"],
    ["teamAdminA"],
    ["deptAdminEng"],
    ["memberA"],
    ["viewerNone"],
  ] as const)(
    "%s is 403 FORBIDDEN before parsing, with no LiteLLM call and no write (T-MI1, LT-MI1)",
    async (who) => {
      signInAs(who);
      const { res } = await post({});
      await expectError(res, 403, "FORBIDDEN");
      const valid = await post(create);
      await expectError(valid.res, 403, "FORBIDDEN");
      expect(state.fake.calls).toHaveLength(0);
      expect(await linkOf(PEOPLE.alice.oid)).toBeFalsy();
    },
  );

  // Own oid: the oid is in the body, so the 403 can only follow parsing; the
  // route-contract suite cannot cover it (API routes row, M3 Verify).
  it.each(["admin", "orgAdmin"] as const)(
    "%s naming their own oid is 403 FORBIDDEN with one denied record and no LiteLLM call (never link oneself; API routes)",
    async (who) => {
      signInAs(who);
      const { res } = await post({ oid: CALLERS[who].oid });
      await expectError(res, 403, "FORBIDDEN");
      expect(state.fake.calls).toHaveLength(0);
      const denied = (await audit()).filter(
        (r) => r.action === "litellm.user.create",
      );
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({
        result: "denied",
        actor: CALLERS[who].oid,
      });
    },
  );

  it("the own-oid 403 follows parsing: a malformed body naming the caller's oid is 400, not 403", async () => {
    signInAs("admin");
    const { res } = await post({ oid: CALLERS.admin.oid, extra: true });
    await expectError(res, 400, "BAD_REQUEST");
    const denied = (await audit()).filter((r) => r.result === "denied");
    expect(denied).toHaveLength(0);
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE (LT11)", async () => {
    useEnv({ AUTH_ACCESS_MODE: "open" });
    signInAs("admin");
    const { res } = await post(create);
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE and nothing is linked (error codes; LT12)", async () => {
    installFake(state, { outage: true });
    signInAs("admin");
    const { res } = await post(create);
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(await linkOf(PEOPLE.alice.oid)).toBeFalsy();
  });
});
