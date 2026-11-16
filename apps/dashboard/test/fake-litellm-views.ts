import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ApiErrorBodySchema } from "@llm-usage-lens/shared";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { putIdentityLink } from "@/lib/data/access/identity-links";
import { ctxAt, ok } from "@/lib/data/access/access-test-support";
import { putTeamLink } from "@/lib/data/litellm/team-links";
import { createFakeLiteLLM } from "@/test/fake-litellm";
import type { FakeCall, FakeHandler } from "@/test/fake-litellm";
import {
  OTHER_USER_ID,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
} from "@/test/fake-litellm-gateway";
import { CALLERS, seedOrg, signInAs } from "@/test/scope-fixtures";
import type { CallerName } from "@/test/scope-fixtures";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
  testDoc,
} from "@/test/test-support";

// Test-only harness for the L3 read-route suites (not imported by production
// code). Rule 60.22: DynamoDB Local; only the session (vi.mock("@/auth") in
// each test file) and the in-process fake LiteLLM are injected (Rule 60.24).
// Source: docs/specs/2026-11-10-litellm.md — "Roles and rights", "Reads",
// "Identity mapping and members", "API routes".

export const HOST = "localhost:3000";
export const BASE_URL = `http://${HOST}`;
export const DATES = "dateFrom=2026-11-01&dateTo=2026-11-14";

// LiteLLM team ids of the four linked dashboard teams; team-u is in
// dept-eng but never linked ("not connected to LiteLLM").
export const LTEAM = {
  "team-a": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "team-b": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "team-c": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "team-m": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
} as const;
export const UNLINKED_LTEAM = "99999999-9999-4999-8999-999999999999";
export const LUSER = {
  memberA: "a1@company.com",
  memberB: "b1@company.com",
} as const;

// Sentinels: every one must be absent from every response (reduction of loose
// upstream rows to allowlisted fields; LT1, LT9, LT20).
export const SENTINELS = [
  "sk-KEY-VALUE-SENTINEL",
  "DAILY-SENTINEL",
  "SPENDLOG-SENTINEL",
  "MEMBERSHIP-SENTINEL",
  "USERTEAM-SENTINEL",
  "AUDIT-VALUE-SENTINEL",
  "SECRET-HASH-SENTINEL",
] as const;
export function expectNoSentinels(body: unknown) {
  const text = JSON.stringify(body);
  for (const s of SENTINELS) expect(text, s).not.toContain(s);
}

export type ViewsFakeOptions = {
  outage?: boolean;
  // GET /user/list ignores `team=` (a misbehaving or older proxy), so the
  // route's own post-call filtering is what the test sees (LT21).
  ignoreTeamFilter?: boolean;
  teamModels?: string[];
  extraKeys?: Array<Record<string, unknown>>;
  // Extra rows for GET /user/list (LiteLLM-shaped; `teams` are LiteLLM ids).
  extraUsers?: Array<Record<string, unknown>>;
};

// L3b: LiteLLM users known to the fake. `id` differs from the email for the
// unlinked-caller case so a composed id would be caught (LD13). `teams` are
// LiteLLM team ids, as GET /user/list and GET /user/info report them.
export const USER_ROWS = [
  { id: "a1@company.com", spend: 3.25, max: 10, teams: ["team-a"] },
  { id: "b1@company.com", spend: 4, max: 10, teams: ["team-b"] },
  { id: "c1@company.com", spend: 5, max: 10, teams: ["team-c"] },
  { id: "ab@company.com", spend: 6, max: 10, teams: ["team-a", "team-b"] },
  { id: "mix@company.com", spend: 7, max: null, teams: ["team-a", "team-c"] },
  { id: "lone@company.com", spend: 0, max: null, teams: [] },
  { id: "uid-ta-0001", email: "ta@company.com", spend: 1, max: 5, teams: [] },
].map((u) => ({
  user_id: u.id,
  user_email: u.email ?? u.id,
  spend: u.spend,
  max_budget: u.max,
  teams: u.teams.map(
    (t) => (LTEAM as Record<string, string>)[t] ?? UNLINKED_LTEAM,
  ),
  // Loose upstream fields that must never leave the server (LT1, LT9).
  sso_user_id: "SECRET-HASH-SENTINEL",
  metadata: { note: "USERTEAM-SENTINEL" },
}));
export const GHOST_USER_ID = "ghost@company.com";

const keyRow = (token: string, team: string | null, user: string) => ({
  token,
  team_id: team,
  user_id: user,
  key_alias: `alias-${token.slice(0, 1)}`,
  blocked: false,
  expires: null,
  models: ["claude-sonnet"],
  spend: 2.5,
  max_budget: 10,
  rpm_limit: 5,
  // The key VALUE must never surface (Roles and rights; LT1, LT9).
  key: "sk-KEY-VALUE-SENTINEL",
  key_name: "sk-...SENTINEL",
});

export function viewsHandler(opts: ViewsFakeOptions = {}): FakeHandler {
  return (call: FakeCall) => {
    if (opts.outage) return "network-error";
    const q = new URL(call.url).searchParams;
    const route = `${call.method} ${call.path}`;
    switch (route) {
      case "GET /team/info": {
        const teamId = q.get("team_id");
        return {
          status: 200,
          body: {
            team_id: teamId,
            team_info: {
              team_id: teamId,
              team_alias: "Alpha",
              max_budget: 100,
              soft_budget: 80,
              budget_duration: "30d",
              spend: 12.5,
              models: opts.teamModels ?? ["claude-sonnet"],
              rpm_limit: 60,
              tpm_limit: 6000,
              members_with_roles: [
                {
                  user_id: LUSER.memberA,
                  user_email: LUSER.memberA,
                  role: "user",
                },
              ],
            },
            keys: [],
            team_memberships: [
              {
                user_id: LUSER.memberA,
                team_id: teamId,
                spend: 3.25,
                budget_id: "b1",
                internal_note: "MEMBERSHIP-SENTINEL",
                litellm_budget_table: {
                  max_budget: 10,
                  rpm_limit: 5,
                  tpm_limit: 500,
                  created_by: "MEMBERSHIP-SENTINEL",
                },
              },
            ],
          },
        };
      }
      case "GET /team/daily/activity/aggregated":
      case "GET /user/daily/activity":
        return {
          status: 200,
          body: {
            results: [
              {
                date: "2026-11-02",
                metrics: {
                  spend: 1.5,
                  prompt_tokens: 10,
                  completion_tokens: 5,
                  total_tokens: 15,
                  api_requests: 3,
                  successful_requests: 3,
                  failed_requests: 0,
                },
                breakdown: {
                  api_keys: {
                    [TOKEN_A]: { metadata: { key_alias: "DAILY-SENTINEL" } },
                  },
                },
                raw_secret: "DAILY-SENTINEL",
              },
            ],
            metadata: { total_spend: 1.5 },
          },
        };
      case "GET /spend/logs/v2":
        return {
          status: 200,
          body: {
            data: [
              {
                request_id: "req-1",
                startTime: "2026-11-02T01:00:00Z",
                model: "claude-sonnet",
                spend: 0.01,
                total_tokens: 15,
                prompt_tokens: 10,
                completion_tokens: 5,
                user: LUSER.memberA,
                team_id: q.get("team_id"),
                api_key: "SPENDLOG-SENTINEL-HASH",
                messages: "SPENDLOG-SENTINEL-PROMPT",
                response: "SPENDLOG-SENTINEL-RESPONSE",
                metadata: { note: "SPENDLOG-SENTINEL-META" },
                request_tags: ["SPENDLOG-SENTINEL-TAG"],
              },
            ],
            total: 1,
            page: 1,
            page_size: 25,
            total_pages: 1,
          },
        };
      case "GET /user/list": {
        const email = q.get("user_email")?.toLowerCase();
        const search = q.get("search")?.toLowerCase();
        const team = q.get("team");
        const all = [...USER_ROWS, ...(opts.extraUsers ?? [])] as Array<
          (typeof USER_ROWS)[number]
        >;
        const matching = all.filter(
          (u) =>
            (!email || u.user_email === email) &&
            (!search ||
              u.user_id.toLowerCase().includes(search) ||
              u.user_email.toLowerCase().includes(search)) &&
            (!team || opts.ignoreTeamFilter || u.teams.includes(team)),
        );
        // LiteLLM pages its own list (page, page_size).
        const page = Number(q.get("page") ?? 1);
        const pageSize = Number(q.get("page_size") ?? 25);
        const users = matching.slice((page - 1) * pageSize, page * pageSize);
        return {
          status: 200,
          body: {
            users,
            total: matching.length,
            page,
            page_size: pageSize,
            total_pages: Math.max(1, Math.ceil(matching.length / pageSize)),
          },
        };
      }
      case "GET /user/info": {
        const userId = q.get("user_id");
        if (userId === GHOST_USER_ID) {
          return { status: 404, body: { detail: "user not found" } };
        }
        const known = USER_ROWS.find((u) => u.user_id === userId);
        const isLinkedFixture = (Object.values(LUSER) as string[]).includes(
          userId ?? "",
        );
        if (known && !isLinkedFixture) {
          return {
            status: 200,
            body: {
              user_id: userId,
              user_info: {
                user_id: userId,
                user_email: known.user_email,
                user_role: "internal_user",
                spend: known.spend,
                max_budget: known.max_budget,
              },
              keys: [],
              teams: known.teams.map((t) => ({
                team_id: t,
                team_alias: "T",
                internal_note: "USERTEAM-SENTINEL",
              })),
            },
          };
        }
        return {
          status: 200,
          body: {
            user_id: userId,
            user_info: {
              user_id: userId,
              user_email: userId,
              user_role: "internal_user",
              spend: 7.5,
              max_budget: 20,
            },
            keys: [
              keyRow(TOKEN_A, LTEAM["team-a"], userId ?? ""),
              // A key of another person, and one in a team the dashboard does
              // not link: both outside the caller's scope.
              keyRow(TOKEN_B, LTEAM["team-a"], OTHER_USER_ID),
              keyRow(TOKEN_C, UNLINKED_LTEAM, userId ?? ""),
            ],
            teams: known
              ? known.teams.map((t) => ({
                  team_id: t,
                  team_alias: "T",
                  internal_note: "USERTEAM-SENTINEL",
                }))
              : [
                  {
                    team_id: LTEAM["team-a"],
                    team_alias: "Alpha",
                    internal_note: "USERTEAM-SENTINEL",
                  },
                  {
                    team_id: UNLINKED_LTEAM,
                    team_alias: "Hidden",
                    internal_note: "USERTEAM-SENTINEL",
                  },
                ],
          },
        };
      }
      case "GET /key/list":
        return {
          status: 200,
          body: {
            keys: [
              keyRow(TOKEN_A, q.get("team_id"), LUSER.memberA),
              keyRow(TOKEN_B, q.get("team_id"), OTHER_USER_ID),
              // Not in the requested team: the route must drop it.
              keyRow(TOKEN_C, UNLINKED_LTEAM, LUSER.memberA),
              ...(opts.extraKeys ?? []),
            ],
            total_count: 3,
            current_page: 1,
            total_pages: 1,
          },
        };
      case "GET /models":
        return {
          status: 200,
          body: {
            data: [
              { id: "claude-sonnet", object: "model" },
              { id: "claude-haiku", object: "model" },
            ],
          },
        };
      case "GET /audit":
        return {
          status: 200,
          body: {
            audit_logs: [
              {
                id: "audit-1",
                updated_at: "2026-11-14T10:00:00Z",
                changed_by: "llm-usage-lens:jane@company.com",
                changed_by_api_key: "SECRET-HASH-SENTINEL",
                action: "updated",
                table_name: "LiteLLM_TeamTable",
                object_id: UNLINKED_LTEAM,
                before_value: { max_budget: "AUDIT-VALUE-SENTINEL-1" },
                updated_values: { max_budget: "AUDIT-VALUE-SENTINEL-2" },
              },
              {
                id: "audit-2",
                updated_at: "2026-11-13T09:00:00Z",
                changed_by: "ops@litellm.test",
                changed_by_api_key: "SECRET-HASH-SENTINEL",
                action: "created",
                table_name: "LiteLLM_VerificationToken",
                object_id: TOKEN_A,
                before_value: null,
                updated_values: { models: "AUDIT-VALUE-SENTINEL-3" },
              },
            ],
            total: 2,
            page: 1,
            page_size: 25,
            total_pages: 1,
          },
        };
      default:
        return { status: 404, body: { detail: "not found" } };
    }
  };
}

export type Suite = { fake: ReturnType<typeof createFakeLiteLLM> };

// Registers the suite-level hooks (call once at the top of a test file) and
// returns the mutable state. The clock is frozen on the seeds' date (Date only).
export function setupViewsSuite(): Suite {
  const state = {} as Suite;
  beforeAll(ensureTestTable);
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));
    await clearTable();
    await seedViews();
    installFake(state);
  });
  afterEach(() => {
    envOverride = {};
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  return state;
}

export function installFake(state: Suite, opts: ViewsFakeOptions = {}) {
  state.fake = createFakeLiteLLM(viewsHandler(opts));
  vi.stubGlobal("fetch", state.fake.fetch);
}

export async function seedViews(opts: { connection?: boolean } = {}) {
  await seedOrg();
  await loadFixtures({
    accounts: [
      makeAccount(5, {
        teamId: "team-u",
        teamName: "U",
        departmentId: "dept-eng",
        departmentName: "Engineering",
      }),
    ],
  });
  if (opts.connection !== false) {
    await testDoc().send(
      new PutCommand({
        TableName: TEST_TABLE_NAME,
        Item: {
          PK: "LITELLM#CONFIG",
          SK: "CONNECTION",
          baseUrl: "http://litellm.test:4000",
          version: 1,
          updatedAt: "2026-11-14T10:00:00.000Z",
        },
      }),
    );
  }
  for (const [teamId, litellmTeamId] of Object.entries(LTEAM)) {
    ok(
      await putTeamLink(
        { teamId, litellmTeamId, version: null },
        ctxAt(undefined, `req-link-${teamId}`),
      ),
    );
  }
  for (const who of ["memberA", "memberB"] as const) {
    ok(
      await putIdentityLink(
        {
          oid: CALLERS[who].oid,
          usageIdentities: [CALLERS[who].email],
          aliases: [],
          litellmUserId: LUSER[who],
          version: null,
        },
        ctxAt(undefined, `req-ident-${who}`),
      ),
    );
  }
}

// Production mode for the Organisation cap tests: APP_ENV=prod (read by the
// route at request time through useEnv) and an https connection, which prod
// requires (base-url: https when APP_ENV=prod). `approved` records the
// per-user approval; without it every caller is capped (T16).
export async function enterProd(opts: { approved?: boolean } = {}) {
  overrideEnv({ APP_ENV: "prod" });
  await testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: {
        PK: "LITELLM#CONFIG",
        SK: "CONNECTION",
        baseUrl: "https://litellm.test:4000",
        version: 1,
        updatedAt: "2026-11-14T10:00:00.000Z",
      },
    }),
  );
  if (opts.approved) await approvePerUser();
}

// Records the per-user approval (GOVERNANCE/PER_USER), lifting the
// Organisation cap in prod (Access Control - "Organisation cap", T16).
export async function approvePerUser() {
  await testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: {
        PK: "GOVERNANCE",
        SK: "PER_USER",
        approvedBy: CALLERS.admin.oid,
        approvedAt: "2026-11-14T10:00:00.000Z",
        reference: "works-council-1",
        version: 1,
      },
    }),
  );
}

export async function setToggles(toggles: Record<string, boolean>) {
  await testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: {
        PK: "LITELLM#CONFIG",
        SK: "TOGGLES",
        version: 1,
        toggles,
        updatedAt: "2026-11-14T10:00:00.000Z",
      },
    }),
  );
}

let envOverride: Record<string, string> = {};
// Route loaders call this with no argument; a test that needs another mode
// calls `useEnv` first.
function overrideEnv(env: Record<string, string>) {
  envOverride = env;
}
export function useEnv(env: Record<string, string>) {
  overrideEnv(env);
}

export function stubLiteLLMEnv() {
  vi.resetModules();
  const vars = {
    APP_ENV: "dev",
    AUTH_ACCESS_MODE: "enforce",
    LITELLM_ALLOWED_HOSTS: "litellm.test:4000",
    LITELLM_SERVICE_KEY: "sk-fake-key-000",
    ...envOverride,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
}

// A signed-in caller with an arbitrary role set (e.g. none).
export async function signInWithRoles(roles: string[]) {
  const { auth } = await import("@/auth");
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: {
      oid: "00000000-0000-4000-8000-0000000009ff",
      email: "norole@company.com",
      roles,
      tid: "t",
      authMethod: "entra",
    },
  });
}

export type RouteHandler = (
  request: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export const request = (path: string) =>
  new Request(`${BASE_URL}${path}`, { headers: { host: HOST } });

export async function call(
  handler: RouteHandler,
  path: string,
  params: Record<string, string> = {},
) {
  const res = await handler(request(path), { params: Promise.resolve(params) });
  const text = await res.clone().text();
  return { res, text, body: JSON.parse(text) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const raw = await res.clone().json();
  expect(ApiErrorBodySchema.parse(raw).error.code).toBe(code);
  expect(raw.data).toBeUndefined();
  expect(res.headers.get("cache-control")).toBe("private, no-store");
}

export const urlsCalled = (state: Suite) =>
  JSON.stringify(state.fake.calls.map((c) => c.url));

type Caller = CallerName | "noRole";
const signIn = async (who: Caller) => {
  if (who === "noRole") await signInWithRoles([]);
  else signInAs(who);
};

// Shared role x read contract of the dashboard-team read routes (Roles and
// rights; Allowlist -> Reads; Access Control Enforcement item 2 - 404
// parity; implementation-phases L3 Verify). A route registers here once; the
// full caller x team matrix runs on `full` routes and a representative
// slice (one case per caller class) on the others (Rule 60.24a).
export function defineTeamReadContract(
  state: Suite,
  spec: {
    full: boolean;
    load: () => Promise<RouteHandler>;
    suffix: string;
    query: string;
    // The allowlisted read whose toggle gates the route.
    toggleOp: string;
    // LiteLLM path the route reads for a linked team.
    upstreamPath: string;
  },
) {
  const path = (team: string) =>
    `/api/litellm/teams/${team}${spec.suffix}${spec.query}`;
  const run = async (team: string) =>
    call(await spec.load(), path(team), { teamId: team });

  const FULL: Array<[Caller, string, 200 | 404]> = [
    ["viewerNone", "team-a", 404],
    ["memberA", "team-a", 404],
    ["memberA", "team-b", 404],
    ["memberB", "team-a", 404],
    ["noRole", "team-a", 404],
    ["teamAdminA", "team-a", 200],
    ["teamAdminA", "team-b", 404],
    ["teamAdminA", "team-c", 404],
    ["deptAdminEng", "team-a", 200],
    ["deptAdminEng", "team-b", 200],
    ["deptAdminEng", "team-c", 404],
    ["deptAdminEng", "team-m", 404], // moved to dept-ops
    ["orgAdmin", "team-a", 200],
    ["orgAdmin", "team-c", 200],
    ["orgAdmin", "team-m", 200],
    ["auditor", "team-a", 200],
    ["auditor", "team-c", 200],
    ["auditor", "team-m", 200],
    ["admin", "team-a", 200],
    ["admin", "team-c", 200],
    ["admin", "team-m", 200],
  ];
  const SLICE: Array<[Caller, string, 200 | 404]> = [
    ["memberA", "team-a", 404],
    ["noRole", "team-a", 404],
    ["teamAdminA", "team-a", 200],
    ["teamAdminA", "team-b", 404],
    ["deptAdminEng", "team-b", 200],
    ["deptAdminEng", "team-m", 404],
    ["auditor", "team-c", 200],
    ["admin", "team-m", 200],
  ];

  describe(`read contract ${spec.suffix || "/"} (Roles and rights; Enforcement 2)`, () => {
    it("401 without a session, no-store, no LiteLLM call (Rule 10.3)", async () => {
      signInAs(null);
      const { res } = await run("team-a");
      await expectError(res, 401, "UNAUTHORIZED");
      expect(state.fake.calls).toHaveLength(0);
    });

    it.each(spec.full ? FULL : SLICE)(
      "%s reading %s is %i",
      async (who, team, status) => {
        await signIn(who);
        const { res, body } = await run(team);
        expect(res.status).toBe(status);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        if (status === 404) {
          expect(body.error.code).toBe("NOT_FOUND");
          expect(state.fake.calls).toHaveLength(0);
        } else {
          expect(body.data).toBeDefined();
        }
      },
    );

    it("an out-of-scope team answers the same 404 body as a missing team (Enforcement 2)", async () => {
      signInAs("teamAdminA");
      const outOfScope = await run("team-b");
      const missing = await run("team-zzz");
      expect(outOfScope.res.status).toBe(404);
      expect(missing.res.status).toBe(404);
      expect(outOfScope.text).toBe(missing.text);
    });

    it("a linked team reads only its own LiteLLM team, never another (identity mapping)", async () => {
      signInAs("admin");
      await run("team-b");
      expect(urlsCalled(state)).toContain(LTEAM["team-b"]);
      expect(urlsCalled(state)).not.toContain(LTEAM["team-a"]);
      expect(state.fake.calls.some((c) => c.path === spec.upstreamPath)).toBe(
        true,
      );
    });

    it("an in-scope team without a link is the 'not connected' state with no LiteLLM call (Identity mapping)", async () => {
      signInAs("admin");
      const { res, body } = await run("team-u");
      expect(res.status).toBe(200);
      expect(body.data.connected).toBe(false);
      expect(state.fake.calls).toHaveLength(0);
    });

    it("a linked team reports connected: true", async () => {
      signInAs("admin");
      const { body } = await run("team-a");
      expect(body.data.connected).toBe(true);
    });

    it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE without upstream detail (error codes; LT12)", async () => {
      signInAs("admin");
      installFake(state, { outage: true });
      const { res, text } = await run("team-a");
      await expectError(res, 503, "LITELLM_UNAVAILABLE");
      expect(text).not.toContain("fetch failed");
    });

    it("no stored connection is 503 LITELLM_UNAVAILABLE (error codes: not configured)", async () => {
      await clearTable();
      await seedViews({ connection: false });
      signInAs("admin");
      const { res } = await run("team-a");
      await expectError(res, 503, "LITELLM_UNAVAILABLE");
    });

    it("a disabled read is 403 OPERATION_DISABLED before any LiteLLM call (Toggles narrow only; LD19)", async () => {
      await setToggles({ [spec.toggleOp]: false });
      signInAs("admin");
      const { res } = await run("team-a");
      await expectError(res, 403, "OPERATION_DISABLED");
      expect(state.fake.calls).toHaveLength(0);
    });

    it("open access mode is 403 OPERATION_UNAVAILABLE (LT11)", async () => {
      signInAs("admin");
      useEnv({ AUTH_ACCESS_MODE: "open" });
      const { res } = await run("team-a");
      await expectError(res, 403, "OPERATION_UNAVAILABLE");
    });

    it("a 200 carries Cache-Control private, no-store (API routes)", async () => {
      signInAs("admin");
      const { res } = await run("team-a");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    });
  });
}

export {
  OTHER_USER_ID,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
} from "@/test/fake-litellm-gateway";
