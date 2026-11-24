import { describe, expect, it, vi } from "vitest";

import { createFakeLiteLLM, healthyHandler } from "@/test/fakes/fake-litellm";
import { DATES, enterProd } from "@/test/fakes/fake-litellm-views";
import { COLUMNS, SPEC_COLUMN } from "@/test/support/litellm-matrix-support";
import type { MatrixColumn } from "@/test/support/litellm-matrix-support";
import {
  CALLERS,
  NEW_LTEAM,
  PEOPLE,
  TOKEN_A,
  auditWith,
  send,
  setToggles,
  setupTeamWritesSuite,
  stubLiteLLMEnv,
  writeCalls,
} from "@/test/support/litellm-team-writes-support";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

// Source: docs/specs/2026-11-10-litellm.md - "Polish and verification (L5)",
// Role x operation matrix. The table is iterated once, row by row and column
// by column, against the in-process fake LiteLLM (Rule 60.24a: complete for a
// security table). Unauthenticated 401 is the route-contract suite's job
// (Rule 60.23). Input validation, toggles, limits and the response bodies have
// their own per-route tests; here a cell is only the authorization outcome of
// a valid request: the expected 200/201 for a check mark, else 403 or 404.
//
// Not in this file: the page row `/dashboard/litellm/team-config`. The page
// moves to /dashboard/manage/* in B2, so its cells are asserted with the
// accessibility floor in L5b (spec - L5 "Split (2026-11-17, coordinator)").
//
// "lower only" cells (org-admin, Lead) are asserted by `raise` rows below: the
// check mark is a lowering request (200); a raising request is 400 BAD_REQUEST
// with no LiteLLM write, as the existing team-write tests define (LiteLLM spec
// - "Budgets and limits"; LD26, LT13). Admin raises (200).

const state = setupTeamWritesSuite();

type Handler = (
  request: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

// One cell per spec column, in the table's order:
// Admin, org-admin, Auditor, Lead, Lead other team, member, Viewer no team.
type Cells = [number, number, number, number, number, number, number];

type Call = { team: string; target: string };
type Request_ = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  params: Record<string, string>;
  body?: unknown;
};

type Row = {
  route: string;
  // The writes also record one `denied` audit entry per refusal (D17).
  write: boolean;
  load: () => Promise<Handler>;
  request: (c: Call) => Request_;
  cells: Cells;
  // A healthy LiteLLM (connection probes) instead of the team-writes fake.
  healthy?: boolean;
  // Enterprise-only operation (LiteLLM spec - Audit, D-LF2): on OSS the route
  // answers 403 OPERATION_UNAVAILABLE, covered in audit/route.integration.test.ts,
  // so the role matrix runs it on Enterprise (APP_ENV=prod).
  enterprise?: boolean;
};

const TEAM_URL = "/api/litellm/teams";
const loader =
  (importer: () => Promise<unknown>, verb: string) =>
  async (): Promise<Handler> => {
    stubLiteLLMEnv();
    return ((await importer()) as Record<string, Handler>)[verb] as Handler;
  };

const WRITE_OK: Cells = [200, 200, 403, 200, 404, 403, 403];
const ADMIN_ONLY: Cells = [200, 403, 403, 403, 403, 403, 403];
const ADMIN_ORG_ADMIN: Cells = [200, 200, 403, 403, 403, 403, 403];
const READ_ADMIN_ORG_AUDITOR: Cells = [200, 200, 200, 403, 403, 403, 403];
const TEAM_READ: Cells = [200, 200, 200, 200, 404, 404, 404];
const withOk = (cells: Cells, ok: number): Cells =>
  cells.map((c) => (c === 200 ? ok : c)) as Cells;

const memberRoute = (suffix: string) => (c: Call) => ({
  path: `${TEAM_URL}/${c.team}/members/${CALLERS.memberA.oid}${suffix}`,
  params: { teamId: c.team, oid: CALLERS.memberA.oid },
});
const keyRoute = (suffix: string) => (c: Call) => ({
  path: `${TEAM_URL}/${c.team}/keys/${TOKEN_A}${suffix}`,
  params: { teamId: c.team, tokenId: TOKEN_A },
});
const teamRoute = (suffix: string) => (c: Call) => ({
  path: `${TEAM_URL}/${c.team}${suffix}`,
  params: { teamId: c.team },
});

const ROWS: Row[] = [
  {
    route: "GET /me",
    write: false,
    load: loader(() => import("../me/route"), "GET"),
    request: () => ({
      method: "GET",
      path: `/api/litellm/me?${DATES}`,
      params: {},
    }),
    cells: [200, 200, 200, 200, 200, 200, 200],
  },

  // ---- L6 combined usage (LiteLLM spec - Combined usage and My usage ->
  // Routes; LT30 gateway write Admin only; LT32 team and organisation combined
  // figures serve global readers only, others get the missing-team 404) ------
  {
    route: "GET /gateway",
    write: false,
    load: loader(() => import("../gateway/route"), "GET"),
    request: () => ({
      method: "GET",
      path: "/api/litellm/gateway",
      params: {},
    }),
    cells: READ_ADMIN_ORG_AUDITOR,
  },
  {
    route: "PUT /gateway",
    write: true,
    load: loader(() => import("../gateway/route"), "PUT"),
    request: () => ({
      method: "PUT",
      path: "/api/litellm/gateway",
      params: {},
      body: {
        version: null,
        principals: [{ type: "iam-role", value: "litellm-gateway" }],
        accountIds: [],
      },
    }),
    cells: ADMIN_ONLY,
  },
  {
    route: "GET /combined/organisation",
    write: false,
    load: loader(() => import("../combined/organisation/route"), "GET"),
    request: () => ({
      method: "GET",
      path: `/api/litellm/combined/organisation?${DATES}`,
      params: {},
    }),
    cells: READ_ADMIN_ORG_AUDITOR,
  },
  {
    route: "GET /combined/teams",
    write: false,
    load: loader(() => import("../combined/teams/route"), "GET"),
    request: () => ({
      method: "GET",
      path: `/api/litellm/combined/teams?${DATES}`,
      params: {},
    }),
    cells: READ_ADMIN_ORG_AUDITOR,
  },
  {
    route: "GET /combined/teams/[teamId]",
    write: false,
    load: loader(() => import("../combined/teams/[teamId]/route"), "GET"),
    request: (c) => ({
      method: "GET",
      path: `/api/litellm/combined/teams/${c.team}?${DATES}`,
      params: { teamId: c.team },
    }),
    cells: [200, 200, 200, 404, 404, 404, 404],
  },
  {
    route: "GET /combined/me",
    write: false,
    load: loader(() => import("../combined/me/route"), "GET"),
    request: () => ({
      method: "GET",
      path: `/api/litellm/combined/me?${DATES}`,
      params: {},
    }),
    cells: [200, 200, 200, 200, 200, 200, 200],
  },
  ...(
    [
      ["", `?${DATES}`, () => import("../teams/[teamId]/route")],
      ["/members", "", () => import("../teams/[teamId]/members/route")],
      ["/keys", "", () => import("../teams/[teamId]/keys/route")],
      [
        "/spend-logs",
        `?${DATES}`,
        () => import("../teams/[teamId]/spend-logs/route"),
      ],
    ] as const
  ).map(
    ([suffix, query, importer]): Row => ({
      route: `GET /teams/[teamId]${suffix}`,
      write: false,
      load: loader(importer, "GET"),
      request: (c) => {
        const r = teamRoute(suffix)(c);
        return { method: "GET", path: `${r.path}${query}`, params: r.params };
      },
      cells: TEAM_READ,
    }),
  ),

  // ---- members -------------------------------------------------------------
  {
    route: "POST /teams/[teamId]/members",
    write: true,
    load: loader(() => import("../teams/[teamId]/members/route"), "POST"),
    request: (c) => ({
      method: "POST",
      path: `${TEAM_URL}/${c.team}/members`,
      params: { teamId: c.team },
      body: { oid: PEOPLE.alice.oid },
    }),
    cells: withOk(WRITE_OK, 201),
  },
  {
    route: "DELETE /teams/[teamId]/members/[oid]",
    write: true,
    load: loader(
      () => import("../teams/[teamId]/members/[oid]/route"),
      "DELETE",
    ),
    request: (c) => ({ method: "DELETE", ...memberRoute("")(c) }),
    cells: WRITE_OK,
  },
  {
    route: "PATCH /teams/[teamId]/members/[oid]/budget",
    write: true,
    load: loader(
      () => import("../teams/[teamId]/members/[oid]/budget/route"),
      "PATCH",
    ),
    request: (c) => ({
      method: "PATCH",
      ...memberRoute("/budget")(c),
      body: { maxBudgetInTeam: 20 },
    }),
    cells: WRITE_OK,
  },
  {
    route: "PATCH /teams/[teamId]/members/[oid]/limits",
    write: true,
    load: loader(
      () => import("../teams/[teamId]/members/[oid]/limits/route"),
      "PATCH",
    ),
    request: (c) => ({
      method: "PATCH",
      ...memberRoute("/limits")(c),
      body: { rpmLimit: 30 },
    }),
    cells: WRITE_OK,
  },
  ...(
    [
      [
        "reset-spend",
        () => import("../teams/[teamId]/members/[oid]/reset-spend/route"),
      ],
      [
        "reset-budget",
        () => import("../teams/[teamId]/members/[oid]/reset-budget/route"),
      ],
      [
        "disable",
        () => import("../teams/[teamId]/members/[oid]/disable/route"),
      ],
      ["enable", () => import("../teams/[teamId]/members/[oid]/enable/route")],
    ] as const
  ).map(
    ([name, importer]): Row => ({
      route: `POST /teams/[teamId]/members/[oid]/${name}`,
      write: true,
      load: loader(importer, "POST"),
      request: (c) => ({ method: "POST", ...memberRoute(`/${name}`)(c) }),
      cells: WRITE_OK,
    }),
  ),

  // ---- keys ----------------------------------------------------------------
  {
    route: "POST /teams/[teamId]/keys",
    write: true,
    load: loader(() => import("../teams/[teamId]/keys/route"), "POST"),
    request: (c) => ({
      method: "POST",
      path: `${TEAM_URL}/${c.team}/keys`,
      params: { teamId: c.team },
      body: { oid: CALLERS.memberA.oid },
    }),
    cells: withOk(WRITE_OK, 201),
  },
  {
    route: "PATCH /teams/[teamId]/keys/[tokenId]",
    write: true,
    load: loader(
      () => import("../teams/[teamId]/keys/[tokenId]/route"),
      "PATCH",
    ),
    request: (c) => ({
      method: "PATCH",
      ...keyRoute("")(c),
      body: { rpmLimit: 3 },
    }),
    cells: WRITE_OK,
  },
  {
    route: "DELETE /teams/[teamId]/keys/[tokenId]",
    write: true,
    load: loader(
      () => import("../teams/[teamId]/keys/[tokenId]/route"),
      "DELETE",
    ),
    request: (c) => ({ method: "DELETE", ...keyRoute("")(c) }),
    cells: WRITE_OK,
  },
  ...(
    [
      ["block", () => import("../teams/[teamId]/keys/[tokenId]/block/route")],
      [
        "unblock",
        () => import("../teams/[teamId]/keys/[tokenId]/unblock/route"),
      ],
      ["rotate", () => import("../teams/[teamId]/keys/[tokenId]/rotate/route")],
    ] as const
  ).map(
    ([name, importer]): Row => ({
      route: `POST /teams/[teamId]/keys/[tokenId]/${name}`,
      write: true,
      load: loader(importer, "POST"),
      request: (c) => ({
        method: "POST",
        ...keyRoute(`/${name}`)(c),
        ...(name === "rotate" ? { body: {} } : {}),
      }),
      cells: WRITE_OK,
    }),
  ),

  // ---- team settings (raise: Admin only, LD26) -----------------------------
  ...(
    [
      ["budget", { maxBudget: 50 }, { maxBudget: 150 }],
      ["limits", { rpmLimit: 30 }, { rpmLimit: 120 }],
    ] as const
  ).flatMap(([name, lower, raise]): Row[] => {
    const importer =
      name === "budget"
        ? () => import("../teams/[teamId]/budget/route")
        : () => import("../teams/[teamId]/limits/route");
    const base = {
      write: true,
      load: loader(importer, "PATCH"),
    };
    return [
      {
        ...base,
        route: `PATCH /teams/[teamId]/${name} (lowering)`,
        request: (c) => ({
          method: "PATCH",
          ...teamRoute(`/${name}`)(c),
          body: lower,
        }),
        cells: WRITE_OK,
      },
      {
        ...base,
        route: `PATCH /teams/[teamId]/${name} (raising: Admin only, LD26)`,
        request: (c) => ({
          method: "PATCH",
          ...teamRoute(`/${name}`)(c),
          body: raise,
        }),
        cells: [200, 400, 403, 400, 404, 403, 403],
      },
    ];
  }),
  {
    route: "PUT /teams/[teamId]/models (restricting)",
    write: true,
    load: loader(() => import("../teams/[teamId]/models/route"), "PUT"),
    request: (c) => ({
      method: "PUT",
      ...teamRoute("/models")(c),
      body: { models: ["claude-sonnet"] },
    }),
    cells: WRITE_OK,
  },
  {
    route:
      "PUT /teams/[teamId]/models (widening is refused for everyone who may write: restrict only, LD26)",
    write: true,
    load: loader(() => import("../teams/[teamId]/models/route"), "PUT"),
    request: (c) => ({
      method: "PUT",
      ...teamRoute("/models")(c),
      body: { models: ["claude-sonnet", "claude-haiku"] },
    }),
    cells: [400, 400, 403, 400, 404, 403, 403],
  },
  {
    route: "POST /teams (create and link)",
    write: true,
    load: loader(() => import("../teams/route"), "POST"),
    request: () => ({
      method: "POST",
      path: TEAM_URL,
      params: {},
      body: { teamId: "team-u", teamAlias: "Unlinked" },
    }),
    cells: withOk(ADMIN_ONLY, 201),
  },

  // ---- reads outside a team ------------------------------------------------
  {
    route: "GET /models",
    write: false,
    load: loader(() => import("../models/route"), "GET"),
    request: () => ({ method: "GET", path: "/api/litellm/models", params: {} }),
    cells: [200, 200, 403, 200, 200, 403, 403],
  },
  {
    route: "GET /users?q=",
    write: false,
    load: loader(() => import("../users/route"), "GET"),
    request: () => ({
      method: "GET",
      path: "/api/litellm/users?q=company",
      params: {},
    }),
    cells: [200, 200, 200, 200, 200, 403, 403],
  },
  {
    // The target is a member of the column's team: a Lead sees members in
    // scope, else 404 (LT21).
    route: "GET /users/[litellmUserId] (a member of the column's team)",
    write: false,
    load: loader(() => import("../users/[litellmUserId]/route"), "GET"),
    request: (c) => {
      const id = { "team-a": "a1", "team-b": "b1", "team-c": "c1" }[c.team];
      const userId = `${id}@company.com`;
      return {
        method: "GET",
        path: `/api/litellm/users/${encodeURIComponent(userId)}?${DATES}`,
        params: { litellmUserId: userId },
      };
    },
    cells: [200, 200, 200, 200, 404, 404, 404],
  },
  {
    route: "GET /org",
    write: false,
    load: loader(() => import("../org/route"), "GET"),
    request: () => ({
      method: "GET",
      path: `/api/litellm/org?${DATES}`,
      params: {},
    }),
    cells: READ_ADMIN_ORG_AUDITOR,
  },
  ...(
    [
      ["audit", `?${DATES}`, () => import("../audit/route"), true],
      ["orphans", "", () => import("../orphans/route"), false],
    ] as const
  ).map(
    ([name, query, importer, enterprise]): Row => ({
      route: `GET /${name}`,
      write: false,
      enterprise,
      load: loader(importer, "GET"),
      request: () => ({
        method: "GET",
        path: `/api/litellm/${name}${query}`,
        params: {},
      }),
      cells: [200, 403, 200, 403, 403, 403, 403],
    }),
  ),

  // ---- configuration -------------------------------------------------------
  ...(
    [
      ["connection", () => import("../connection/route")],
      ["toggles", () => import("../toggles/route")],
      ["team-links", () => import("../team-links/route")],
    ] as const
  ).map(
    ([name, importer]): Row => ({
      route: `GET /${name}`,
      write: false,
      load: loader(importer, "GET"),
      request: () => ({
        method: "GET",
        path: `/api/litellm/${name}`,
        params: {},
      }),
      cells: READ_ADMIN_ORG_AUDITOR,
    }),
  ),
  {
    route: "PUT /toggles",
    write: true,
    load: loader(() => import("../toggles/route"), "PUT"),
    request: () => ({
      method: "PUT",
      path: "/api/litellm/toggles",
      params: {},
      // version 1: the harness stores the toggles document before each cell.
      body: { version: 1, toggles: { blockKey: true } },
    }),
    cells: ADMIN_ORG_ADMIN,
  },
  {
    route: "PUT /team-links/[teamId]",
    write: true,
    load: loader(() => import("../team-links/[teamId]/route"), "PUT"),
    request: () => ({
      method: "PUT",
      path: "/api/litellm/team-links/team-u",
      params: { teamId: "team-u" },
      body: { litellmTeamId: NEW_LTEAM, version: null },
    }),
    cells: ADMIN_ORG_ADMIN,
  },
  {
    route: "DELETE /team-links/[teamId]",
    write: true,
    load: loader(() => import("../team-links/[teamId]/route"), "DELETE"),
    request: () => ({
      method: "DELETE",
      path: "/api/litellm/team-links/team-a",
      params: { teamId: "team-a" },
    }),
    cells: ADMIN_ORG_ADMIN,
  },
  {
    route: "PUT /connection",
    write: true,
    healthy: true,
    load: loader(() => import("../connection/route"), "PUT"),
    request: () => ({
      method: "PUT",
      path: "/api/litellm/connection",
      params: {},
      body: { baseUrl: "http://litellm.test:4000", version: 1 },
    }),
    cells: ADMIN_ONLY,
  },
  {
    route: "POST /connection/test",
    write: true,
    healthy: true,
    load: loader(() => import("../connection/test/route"), "POST"),
    request: () => ({
      method: "POST",
      path: "/api/litellm/connection/test",
      params: {},
      body: {},
    }),
    cells: ADMIN_ONLY,
  },
];

const KINDS: Record<number, string> = {
  200: "ok",
  201: "ok",
  400: "BAD_REQUEST",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
};

async function deniedRecords() {
  return (await auditWith("litellm.")).filter((r) => r.result === "denied");
}

describe.each(ROWS)("$route", (row) => {
  it.each(COLUMNS)(
    `$name (LiteLLM spec - L5 Role x operation matrix)`,
    async (col: MatrixColumn) => {
      // The operations that are off by default (LD10) are on, so a check mark
      // means authorization passed, not that a toggle was off.
      await setToggles({ deleteKey: true, resetMemberSpend: true });
      if (row.healthy) {
        state.fake = createFakeLiteLLM(healthyHandler);
        vi.stubGlobal("fetch", state.fake.fetch);
      }
      if (row.enterprise) await enterProd();
      await col.signIn();

      const expected = row.cells[SPEC_COLUMN[col.column]] as number;
      const req = row.request({ team: col.team, target: "" });
      const { res, body } = await send(await row.load(), req);

      expect(res.status).toBe(expected);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      if (expected < 300) {
        expect(body.data).toBeDefined();
        return;
      }
      expect(body.error.code).toBe(KINDS[expected]);
      expect(body.data).toBeUndefined();
      if (expected === 400) {
        // A lower-only refusal makes no write (LD26, LT13).
        expect(writeCalls(state)).toHaveLength(0);
        return;
      }
      if (row.write) {
        // D17: one `denied` record per refused write, a Lead's 404 included.
        expect(await deniedRecords()).toHaveLength(1);
        expect(state.fake.calls).toHaveLength(0);
      }
    },
  );
});

// D17: a Lead's 404 on another team's write is audited as `denied`/NOT_FOUND
// (the same refusal body as a missing team, so nothing is revealed).
describe("a Lead's refused write on another team (D17)", () => {
  it("writes one denied NOT_FOUND record naming the actor and the fixed route pattern", async () => {
    const { signInAs } = await import("@/test/fixtures/scope-fixtures");
    signInAs("teamAdminA");
    const { res } = await send(
      await loader(() => import("../teams/[teamId]/members/route"), "POST")(),
      {
        method: "POST",
        path: `${TEAM_URL}/team-b/members`,
        params: { teamId: "team-b" },
        body: { oid: PEOPLE.alice.oid },
      },
    );
    expect(res.status).toBe(404);
    const denied = await deniedRecords();
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      action: "litellm.member.add",
      result: "denied",
      code: "NOT_FOUND",
      actor: CALLERS.teamAdminA.oid,
      route: { method: "POST", pattern: "/api/litellm/teams/[teamId]/members" },
    });
  });
});
