import { describe, expect, it, vi } from "vitest";

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
} from "@/test/fake-litellm-views";
import { signInAs } from "@/test/scope-fixtures";
import type { CallerName } from "@/test/scope-fixtures";

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
  const mod = await import("@/test/next-cache-fake");
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

  it("403 comes before input parsing: a Viewer with no q still gets 403 (Rule 10.3)", async () => {
    signInAs("memberA");
    const { res } = await get("");
    await expectError(res, 403, "FORBIDDEN");
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
    ["missing", ""],
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
