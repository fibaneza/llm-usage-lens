import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { LITELLM_OPERATION_NAMES } from "@llm-usage-lens/shared";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { LITELLM_OPERATIONS } from "@/lib/litellm/allowlist";
import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import type { FakeCall } from "@/test/fakes/fake-litellm";
import {
  AUTO_KEY_TRAP,
  NEW_KEY_VALUE,
  NEW_TOKEN,
  OTHER_TEAM_ID,
  OTHER_USER_ID,
  TEAM_ID,
  TOKEN_A,
  TOKEN_B,
  USER_ID,
  gatewayHandler,
} from "@/test/fakes/fake-litellm-gateway";
import type { GatewayFakeOptions } from "@/test/fakes/fake-litellm-gateway";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-litellm.md — "Allowlist (the gateway)" (one
// typed function per row; fixed method and path; strict Zod input schema
// builds the body from typed values, unknown fields rejected; every response
// Zod-parsed), "Reads" and "Writes" tables (built queries and the only body
// fields), "Audit" item 2 (litellm-changed-by on every write), "Gateway
// guardrails" item 4, threats LT4, LT10, LT14, LT17, LT19; contract snapshot
// docs/litellm/openapi.json (1.109.1); implementation-phases L2 ("contract
// test of every call against the snapshot").
//
// Contract for the developer (lib/litellm/operations.ts): one exported async
// function per name in LITELLM_OPERATION_NAMES. Reads take one typed input
// (listProxyTeams / listProxyModels take none). Writes take (input, { actor })
// where actor = { oid, email? } is the session identity. Inputs are camelCase,
// server-resolved LiteLLM ids (litellmTeamId, litellmUserId, tokenId = token
// hash); bodies are snake_case per the tables.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OPENAPI = JSON.parse(
  readFileSync(join(ROOT, "docs/litellm/openapi.json"), "utf8"),
) as {
  paths: Record<string, Record<string, OpenApiOp>>;
  components: { schemas: Record<string, OpenApiSchema> };
};
type OpenApiSchema = {
  $ref?: string;
  anyOf?: OpenApiSchema[];
  properties?: Record<string, unknown>;
  required?: string[];
};
type OpenApiOp = {
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> };
};

const KEY = "sk-fake-key-000";
const BASE = "http://litellm.test:4000";
const ACTOR = { oid: "oid-actor-1", email: "Admin.User@Company.com" };
const CTX = { actor: ACTOR };
const HEADER = "llm-usage-lens:admin.user@company.com";
const D1 = "2026-11-01";
const D2 = "2026-11-14";

type Ops = Record<string, (input?: unknown, ctx?: unknown) => Promise<unknown>>;

async function load(env: Record<string, string> = {}): Promise<{ ops: Ops }> {
  vi.resetModules();
  // Security architecture item 7: APP_ENV=prod requires an https base URL,
  // so prod (Enterprise) cases store an https connection on the allowed host.
  if (env.APP_ENV === "prod") await storeConnection("https://litellm.test");
  const vars = {
    APP_ENV: "dev",
    AUTH_ACCESS_MODE: "enforce",
    LITELLM_ALLOWED_HOSTS: "litellm.test:4000",
    LITELLM_SERVICE_KEY: KEY,
    ...env,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  const mod = (await import("./operations")) as unknown as Ops;
  return { ops: mod };
}

async function storeConnection(baseUrl: string = BASE) {
  await testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: {
        PK: "LITELLM#CONFIG",
        SK: "CONNECTION",
        baseUrl,
        version: 1,
        updatedAt: "2026-11-14T10:00:00.000Z",
      },
    }),
  );
}

// The destructive operations default off (LD10); the body tests enable them.
async function storeToggles(toggles: Record<string, boolean>) {
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

let fake: ReturnType<typeof createFakeLiteLLM>;
function install(opts: GatewayFakeOptions = {}) {
  fake = createFakeLiteLLM(gatewayHandler(opts));
  vi.stubGlobal("fetch", fake.fetch);
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  await storeConnection();
  await storeToggles({ deleteKey: true, resetMemberSpend: true });
  install();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const q = (c: FakeCall) =>
  Object.fromEntries(new URL(c.url).searchParams.entries());

describe("the operations module", () => {
  it("exports one function per allowlisted operation", async () => {
    const { ops } = await load();
    for (const name of LITELLM_OPERATION_NAMES) {
      // MG-D11a: requestBudgetReset has no LiteLLM route, hence no gateway function.
      if (LITELLM_OPERATIONS[name].routes.length === 0) {
        expect(ops, name).not.toHaveProperty(name);
        continue;
      }
      expect(typeof ops[name], name).toBe("function");
    }
  });
});

// ---------------------------------------------------------------- cases ----

type Expected = {
  method: "GET" | "POST";
  template: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
};
type Case = {
  name: string;
  write: boolean;
  fake?: GatewayFakeOptions;
  env?: Record<string, string>;
  run: (ops: Ops) => Promise<unknown>;
  calls: Expected[];
};

// openapi 1.109.1: `timezone` is an integer offset in minutes; 0 is UTC (LD20).
const TZ = "0";
const DATE = expect.any(String);
const RESET_PATH = (leaf: string) =>
  `/team/${TEAM_ID}/member/${encodeURIComponent(USER_ID)}/${leaf}`;
const META = (extra: Record<string, unknown> = {}) => ({
  source: "llm-usage-lens",
  dashboardTeamId: "team-a",
  ...extra,
});

const CASES: Case[] = [
  // ---- reads
  {
    name: "getTeam",
    write: false,
    run: (o) => o.getTeam!({ litellmTeamId: TEAM_ID }),
    calls: [
      {
        method: "GET",
        template: "/team/info",
        path: "/team/info",
        query: { team_id: TEAM_ID },
      },
    ],
  },
  {
    name: "listProxyTeams",
    write: false,
    run: (o) => o.listProxyTeams!(),
    calls: [
      { method: "GET", template: "/team/list", path: "/team/list", query: {} },
    ],
  },
  {
    name: "getTeamDailySpend",
    write: false,
    run: (o) =>
      o.getTeamDailySpend!({
        litellmTeamId: TEAM_ID,
        startDate: D1,
        endDate: D2,
      }),
    calls: [
      {
        method: "GET",
        template: "/team/daily/activity/aggregated",
        path: "/team/daily/activity/aggregated",
        query: {
          team_ids: TEAM_ID,
          start_date: DATE,
          end_date: DATE,
          timezone: TZ,
        },
      },
    ],
  },
  {
    name: "getUser",
    write: false,
    run: (o) => o.getUser!({ litellmUserId: USER_ID }),
    calls: [
      {
        method: "GET",
        template: "/user/info",
        path: "/user/info",
        query: { user_id: USER_ID },
      },
    ],
  },
  {
    name: "findUserByEmail",
    write: false,
    run: (o) => o.findUserByEmail!({ email: "Jane@Company.COM" }),
    calls: [
      {
        method: "GET",
        template: "/user/list",
        path: "/user/list",
        query: { user_email: "jane@company.com" },
      },
    ],
  },
  {
    name: "searchUsers",
    write: false,
    run: (o) =>
      o.searchUsers!({
        search: "  Jane  ",
        page: 2,
        pageSize: 25,
        litellmTeamId: TEAM_ID,
      }),
    calls: [
      {
        method: "GET",
        template: "/user/list",
        path: "/user/list",
        query: { search: "Jane", page: "2", page_size: "25", team: TEAM_ID },
      },
    ],
  },
  {
    name: "getTeamDailySpend (org: all linked teams in one call, L3b)",
    write: false,
    run: (o) =>
      o.getTeamDailySpend!({
        litellmTeamIds: [TEAM_ID, OTHER_TEAM_ID],
        startDate: D1,
        endDate: D2,
      }),
    calls: [
      {
        method: "GET",
        template: "/team/daily/activity/aggregated",
        path: "/team/daily/activity/aggregated",
        query: {
          team_ids: `${TEAM_ID},${OTHER_TEAM_ID}`,
          start_date: DATE,
          end_date: DATE,
          timezone: TZ,
        },
      },
    ],
  },
  {
    name: "getUserDailySpend",
    write: false,
    run: (o) =>
      o.getUserDailySpend!({
        litellmUserId: USER_ID,
        startDate: D1,
        endDate: D2,
      }),
    calls: [
      {
        method: "GET",
        template: "/user/daily/activity",
        path: "/user/daily/activity",
        // L6 paging fix (LiteLLM spec - Combined usage -> LiteLLM reads used,
        // LT34): the first request names page 1 and page_size 1000.
        query: {
          user_id: USER_ID,
          start_date: DATE,
          end_date: DATE,
          timezone: TZ,
          page: "1",
          page_size: "1000",
        },
      },
    ],
  },
  {
    name: "listKeys",
    write: false,
    run: (o) => o.listKeys!({ litellmTeamId: TEAM_ID, page: 2, size: 100 }),
    calls: [
      {
        method: "GET",
        template: "/key/list",
        path: "/key/list",
        query: {
          team_id: TEAM_ID,
          return_full_object: "true",
          page: "2",
          size: "100",
        },
      },
    ],
  },
  {
    name: "getKey",
    write: false,
    run: (o) => o.getKey!({ tokenId: TOKEN_A }),
    calls: [
      {
        method: "GET",
        template: "/key/info",
        path: "/key/info",
        query: { key: TOKEN_A },
      },
    ],
  },
  {
    name: "listSpendLogs",
    write: false,
    run: (o) =>
      o.listSpendLogs!({
        litellmTeamId: TEAM_ID,
        startDate: D1,
        endDate: D2,
        page: 1,
        pageSize: 100,
      }),
    calls: [
      {
        method: "GET",
        template: "/spend/logs/v2",
        path: "/spend/logs/v2",
        query: {
          team_id: TEAM_ID,
          start_date: DATE,
          end_date: DATE,
          page: "1",
          page_size: "100",
        },
      },
    ],
  },
  {
    name: "listProxyModels",
    write: false,
    run: (o) => o.listProxyModels!(),
    calls: [
      {
        method: "GET",
        template: "/models",
        path: "/models",
        query: { return_wildcard_routes: "false" },
      },
    ],
  },
  {
    name: "listProxyAuditLog",
    write: false,
    run: (o) =>
      o.listProxyAuditLog!({
        startDate: D1,
        endDate: D2,
        page: 1,
        pageSize: 50,
        action: "updated",
        tableName: "LiteLLM_TeamTable",
        objectId: TEAM_ID,
      }),
    calls: [
      {
        method: "GET",
        template: "/audit",
        path: "/audit",
        query: {
          start_date: DATE,
          end_date: DATE,
          page: "1",
          page_size: "50",
          action: "updated",
          table_name: "LiteLLM_TeamTable",
          object_id: TEAM_ID,
        },
      },
    ],
  },
  {
    name: "getGlobalSpendReport",
    write: false,
    env: { APP_ENV: "prod", LITELLM_ALLOWED_HOSTS: "litellm.test" },
    fake: { edition: "enterprise" },
    run: (o) => o.getGlobalSpendReport!({ startDate: D1, endDate: D2 }),
    calls: [
      {
        method: "GET",
        template: "/global/spend/report",
        path: "/global/spend/report",
        query: { start_date: DATE, end_date: DATE, group_by: "team" },
      },
    ],
  },
  // ---- writes
  {
    name: "createTeam",
    write: true,
    run: (o) =>
      o.createTeam!(
        {
          teamAlias: "Alpha",
          dashboardTeamId: "team-a",
          maxBudget: 100,
          budgetDuration: "30d",
          rpmLimit: 60,
          tpmLimit: 1000,
          models: ["claude-sonnet"],
        },
        CTX,
      ),
    calls: [
      {
        method: "POST",
        template: "/team/new",
        path: "/team/new",
        body: {
          team_alias: "Alpha",
          max_budget: 100,
          budget_duration: "30d",
          rpm_limit: 60,
          tpm_limit: 1000,
          models: ["claude-sonnet"],
          metadata: META(),
        },
      },
    ],
  },
  {
    name: "setTeamBudget",
    write: true,
    run: (o) =>
      o.setTeamBudget!(
        {
          litellmTeamId: TEAM_ID,
          maxBudget: 50,
          budgetDuration: "30d",
          softBudget: 40,
        },
        CTX,
      ),
    calls: [
      {
        method: "POST",
        template: "/team/update",
        path: "/team/update",
        body: {
          team_id: TEAM_ID,
          max_budget: 50,
          budget_duration: "30d",
          soft_budget: 40,
        },
      },
    ],
  },
  {
    name: "setTeamLimits",
    write: true,
    run: (o) =>
      o.setTeamLimits!(
        {
          litellmTeamId: TEAM_ID,
          rpmLimit: 10,
          tpmLimit: 100,
          modelRpmLimit: { "claude-sonnet": 5 },
          modelTpmLimit: { "claude-sonnet": 50 },
          teamMemberRpmLimit: 3,
          teamMemberTpmLimit: 30,
        },
        CTX,
      ),
    calls: [
      {
        method: "POST",
        template: "/team/update",
        path: "/team/update",
        body: {
          team_id: TEAM_ID,
          rpm_limit: 10,
          tpm_limit: 100,
          model_rpm_limit: { "claude-sonnet": 5 },
          model_tpm_limit: { "claude-sonnet": 50 },
          team_member_rpm_limit: 3,
          team_member_tpm_limit: 30,
        },
      },
    ],
  },
  {
    name: "setTeamModels",
    write: true,
    run: (o) =>
      o.setTeamModels!(
        { litellmTeamId: TEAM_ID, models: ["claude-sonnet"] },
        CTX,
      ),
    calls: [
      {
        method: "POST",
        template: "/team/update",
        path: "/team/update",
        body: { team_id: TEAM_ID, models: ["claude-sonnet"] },
      },
    ],
  },
  {
    name: "addTeamMember (OSS, user missing: /user/new then /team/member_add)",
    write: true,
    fake: { userExists: false },
    run: (o) =>
      o.addTeamMember!(
        {
          litellmTeamId: TEAM_ID,
          email: "Jane@Company.com",
          maxBudgetInTeam: 10,
          budgetDuration: "30d",
        },
        CTX,
      ),
    calls: [
      {
        method: "GET",
        template: "/user/list",
        path: "/user/list",
        query: { user_email: "jane@company.com" },
      },
      {
        method: "POST",
        template: "/user/new",
        path: "/user/new",
        body: {
          user_id: "jane@company.com",
          user_email: "jane@company.com",
          user_role: "internal_user",
          auto_create_key: false,
          send_invite_email: false,
        },
      },
      {
        method: "POST",
        template: "/team/member_add",
        path: "/team/member_add",
        body: {
          team_id: TEAM_ID,
          member: { user_id: "jane@company.com", role: "user" },
          max_budget_in_team: 10,
          budget_duration: "30d",
        },
      },
    ],
  },
  {
    name: "addTeamMember (user exists: no /user/new)",
    write: true,
    fake: { userExists: true },
    run: (o) =>
      o.addTeamMember!(
        { litellmTeamId: TEAM_ID, email: "jane@company.com" },
        CTX,
      ),
    calls: [
      {
        method: "GET",
        template: "/user/list",
        path: "/user/list",
        query: { user_email: "jane@company.com" },
      },
      {
        method: "POST",
        template: "/team/member_add",
        path: "/team/member_add",
        body: {
          team_id: TEAM_ID,
          member: { user_id: "jane@company.com", role: "user" },
        },
      },
    ],
  },
  {
    name: "removeTeamMember",
    write: true,
    run: (o) =>
      o.removeTeamMember!(
        { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
        CTX,
      ),
    calls: [
      {
        method: "POST",
        template: "/team/member_delete",
        path: "/team/member_delete",
        body: { team_id: TEAM_ID, user_id: USER_ID },
      },
    ],
  },
  {
    name: "setMemberBudget",
    write: true,
    run: (o) =>
      o.setMemberBudget!(
        {
          litellmTeamId: TEAM_ID,
          litellmUserId: USER_ID,
          maxBudgetInTeam: 5,
          budgetDuration: "30d",
        },
        CTX,
      ),
    calls: [
      {
        method: "POST",
        template: "/team/member_update",
        path: "/team/member_update",
        body: {
          team_id: TEAM_ID,
          user_id: USER_ID,
          max_budget_in_team: 5,
          budget_duration: "30d",
        },
      },
    ],
  },
  {
    name: "setMemberLimits",
    write: true,
    run: (o) =>
      o.setMemberLimits!(
        {
          litellmTeamId: TEAM_ID,
          litellmUserId: USER_ID,
          rpmLimit: 5,
          tpmLimit: 50,
        },
        CTX,
      ),
    calls: [
      {
        method: "POST",
        template: "/team/member_update",
        path: "/team/member_update",
        body: {
          team_id: TEAM_ID,
          user_id: USER_ID,
          rpm_limit: 5,
          tpm_limit: 50,
        },
      },
    ],
  },
  {
    name: "resetMemberSpend",
    write: true,
    run: (o) =>
      o.resetMemberSpend!(
        { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
        CTX,
      ),
    calls: [
      {
        method: "POST",
        template: "/team/{team_id}/member/{user_id}/reset_spend",
        path: RESET_PATH("reset_spend"),
        body: { reset_to: 0 },
      },
    ],
  },
  {
    name: "resetMemberBudget",
    write: true,
    run: (o) =>
      o.resetMemberBudget!(
        { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
        CTX,
      ),
    calls: [
      {
        method: "POST",
        template: "/team/{team_id}/member/{user_id}/reset_budget",
        path: RESET_PATH("reset_budget"),
        body: undefined,
      },
    ],
  },
  {
    name: "blockKey",
    write: true,
    run: (o) => o.blockKey!({ tokenId: TOKEN_A }, CTX),
    calls: [
      {
        method: "POST",
        template: "/key/block",
        path: "/key/block",
        body: { key: TOKEN_A },
      },
    ],
  },
  {
    name: "unblockKey",
    write: true,
    run: (o) => o.unblockKey!({ tokenId: TOKEN_A }, CTX),
    calls: [
      {
        method: "POST",
        template: "/key/unblock",
        path: "/key/unblock",
        body: { key: TOKEN_A },
      },
    ],
  },
  {
    name: "disableMember (blocks only the member's keys in that team)",
    write: true,
    run: (o) =>
      o.disableMember!({ litellmTeamId: TEAM_ID, litellmUserId: USER_ID }, CTX),
    calls: [
      {
        method: "GET",
        template: "/key/list",
        path: "/key/list",
        query: expect.objectContaining({
          team_id: TEAM_ID,
          user_id: USER_ID,
          return_full_object: "true",
        }),
      },
      {
        method: "POST",
        template: "/key/block",
        path: "/key/block",
        body: { key: TOKEN_A },
      },
    ],
  },
  {
    name: "enableMember (unblocks only the member's keys in that team)",
    write: true,
    run: (o) =>
      o.enableMember!({ litellmTeamId: TEAM_ID, litellmUserId: USER_ID }, CTX),
    calls: [
      {
        method: "GET",
        template: "/key/list",
        path: "/key/list",
        query: expect.objectContaining({
          team_id: TEAM_ID,
          user_id: USER_ID,
          return_full_object: "true",
        }),
      },
      {
        method: "POST",
        template: "/key/unblock",
        path: "/key/unblock",
        body: { key: TOKEN_A },
      },
    ],
  },
  {
    name: "generateMemberKey",
    write: true,
    run: (o) =>
      o.generateMemberKey!(
        {
          litellmTeamId: TEAM_ID,
          litellmUserId: USER_ID,
          dashboardTeamId: "team-a",
          models: ["claude-sonnet"],
          maxBudget: 5,
          budgetDuration: "30d",
          rpmLimit: 5,
          tpmLimit: 50,
          maxParallelRequests: 2,
          duration: "30d",
          keyAlias: "jane-key",
        },
        CTX,
      ),
    calls: [
      {
        method: "POST",
        template: "/key/generate",
        path: "/key/generate",
        body: {
          team_id: TEAM_ID,
          user_id: USER_ID,
          models: ["claude-sonnet"],
          max_budget: 5,
          budget_duration: "30d",
          rpm_limit: 5,
          tpm_limit: 50,
          max_parallel_requests: 2,
          duration: "30d",
          key_alias: "jane-key",
          metadata: META({ createdByOid: ACTOR.oid }),
        },
      },
    ],
  },
  {
    name: "updateMemberKey",
    write: true,
    run: (o) =>
      o.updateMemberKey!(
        {
          tokenId: TOKEN_A,
          models: ["claude-sonnet"],
          maxBudget: 5,
          budgetDuration: "30d",
          rpmLimit: 5,
          tpmLimit: 50,
          maxParallelRequests: 2,
          keyAlias: "jane-key",
        },
        CTX,
      ),
    calls: [
      {
        method: "POST",
        template: "/key/update",
        path: "/key/update",
        body: {
          key: TOKEN_A,
          models: ["claude-sonnet"],
          max_budget: 5,
          budget_duration: "30d",
          rpm_limit: 5,
          tpm_limit: 50,
          max_parallel_requests: 2,
          key_alias: "jane-key",
        },
      },
    ],
  },
  {
    name: "deleteKey (exactly one key)",
    write: true,
    run: (o) => o.deleteKey!({ tokenId: TOKEN_A }, CTX),
    calls: [
      {
        method: "POST",
        template: "/key/delete",
        path: "/key/delete",
        body: { keys: [TOKEN_A] },
      },
    ],
  },
  {
    name: "rotateKey (Enterprise: regenerate with exactly { grace_period })",
    write: true,
    env: { APP_ENV: "prod", LITELLM_ALLOWED_HOSTS: "litellm.test" },
    fake: { edition: "enterprise" },
    run: (o) =>
      o.rotateKey!(
        {
          tokenId: TOKEN_A,
          litellmTeamId: TEAM_ID,
          litellmUserId: USER_ID,
          dashboardTeamId: "team-a",
          gracePeriod: "24h",
        },
        CTX,
      ),
    calls: [
      {
        method: "POST",
        template: "/key/{key}/regenerate",
        path: `/key/${TOKEN_A}/regenerate`,
        body: { grace_period: "24h" },
      },
    ],
  },
];

describe("exact requests per operation (LT4) and the contract snapshot", () => {
  it.each(CASES)("$name sends exactly the specified calls", async (c) => {
    install(c.fake);
    const { ops } = await load(c.env);
    await c.run(ops);
    expect(fake.calls).toHaveLength(c.calls.length);
    c.calls.forEach((expected, i) => {
      const call = fake.calls[i]!;
      expect(call.method).toBe(expected.method);
      expect(call.path).toBe(expected.path);
      if (expected.query) expect(q(call)).toEqual(expected.query);
      if ("body" in expected) {
        if (expected.body === undefined) {
          expect([undefined, {}]).toContainEqual(call.body);
        } else {
          expect(call.body).toEqual(expected.body);
        }
      }
    });
  });

  it.each(CASES)(
    "$name: every method, path, query and body field exists in docs/litellm/openapi.json",
    async (c) => {
      install(c.fake);
      const { ops } = await load(c.env);
      await c.run(ops);
      c.calls.forEach((expected, i) => {
        const call = fake.calls[i]!;
        const op =
          OPENAPI.paths[expected.template]?.[call.method.toLowerCase()];
        expect(
          op,
          `${call.method} ${expected.template} in the snapshot`,
        ).toBeDefined();
        const names = new Set(
          (op!.parameters ?? [])
            .filter((p) => p.in === "query")
            .map((p) => p.name),
        );
        for (const key of Object.keys(q(call))) {
          expect(names.has(key), `query ${key} of ${expected.template}`).toBe(
            true,
          );
        }
        for (const p of (op!.parameters ?? []).filter(
          (x) => x.in === "query" && x.required,
        )) {
          expect(q(call)[p.name], `required query ${p.name}`).toBeDefined();
        }
        const fields = bodyFields(op!);
        if (call.body && typeof call.body === "object") {
          for (const key of Object.keys(call.body as object)) {
            expect(
              fields.props.has(key),
              `body ${key} of ${expected.template}`,
            ).toBe(true);
          }
          for (const r of fields.required) {
            expect(
              (call.body as Record<string, unknown>)[r],
              `required body ${r}`,
            ).toBeDefined();
          }
        }
      });
    },
  );

  it("every write call carries litellm-changed-by from the session, including each call of a composed write", async () => {
    for (const c of CASES.filter((x) => x.write)) {
      install(c.fake);
      const { ops } = await load(c.env);
      await c.run(ops);
      const writes = fake.calls.filter((x) => x.method === "POST");
      expect(writes.length, c.name).toBeGreaterThan(0);
      for (const w of writes) {
        expect(w.headers["litellm-changed-by"], `${c.name} ${w.path}`).toBe(
          HEADER,
        );
      }
    }
  });

  it("the contract declares litellm-changed-by on the routes the spec lists", () => {
    for (const p of [
      "/team/new",
      "/team/update",
      "/key/generate",
      "/key/update",
      "/key/delete",
      "/key/block",
      "/key/unblock",
      "/key/{key}/regenerate",
    ]) {
      const op = OPENAPI.paths[p]?.post;
      expect(
        (op?.parameters ?? []).some(
          (x) => x.in === "header" && x.name === "litellm-changed-by",
        ),
        p,
      ).toBe(true);
    }
  });

  it("RegenerateKeyRequest in the snapshot has grace_period", () => {
    expect(
      Object.keys(
        OPENAPI.components.schemas.RegenerateKeyRequest?.properties ?? {},
      ),
    ).toContain("grace_period");
  });
});

function bodyFields(op: OpenApiOp): { props: Set<string>; required: string[] } {
  const props = new Set<string>();
  const required: string[] = [];
  const walk = (s?: OpenApiSchema) => {
    if (!s) return;
    if (s.$ref) {
      const target = OPENAPI.components.schemas[s.$ref.split("/").pop()!];
      if (target) {
        Object.keys(target.properties ?? {}).forEach((k) => props.add(k));
        required.push(...(target.required ?? []));
      }
    }
    Object.keys(s.properties ?? {}).forEach((k) => props.add(k));
    s.anyOf?.forEach(walk);
  };
  walk(op.requestBody?.content?.["application/json"]?.schema);
  return { props, required };
}

describe("bodies never carry what must not be sent (guardrail 4, LT4)", () => {
  const FORBIDDEN = [
    "allowed_routes",
    "permissions",
    "key_type",
    "new_key",
    "new_master_key",
    "allowed_passthrough_routes",
    "object_permission",
    "organization_id",
    "teams",
    "password",
    "sso_user_id",
    "blocked",
  ];

  it("no write body carries a forbidden field; `user_role` only as internal_user on /user/new; `key` only as a token hash on update/block", async () => {
    for (const c of CASES.filter((x) => x.write)) {
      install(c.fake);
      const { ops } = await load(c.env);
      await c.run(ops);
      for (const call of fake.calls.filter((x) => x.method === "POST")) {
        const body = (call.body ?? {}) as Record<string, unknown>;
        for (const f of FORBIDDEN) {
          expect(
            body[f],
            `${c.name}: ${call.path} carries ${f}`,
          ).toBeUndefined();
        }
        if ("user_role" in body) {
          expect(call.path).toBe("/user/new");
          expect(body.user_role).toBe("internal_user");
        }
        if ("key" in body) {
          expect(["/key/update", "/key/block", "/key/unblock"]).toContain(
            call.path,
          );
          expect(body.key).toMatch(/^[a-f0-9]{64}$/);
        }
        expect(body.role === undefined || body.role === "user").toBe(true);
      }
    }
  });

  it("/key/generate never carries a `key` value, `allowed_routes`, `permissions`, `key_type` or `models` widening", async () => {
    const { ops } = await load();
    await ops.generateMemberKey!(
      {
        litellmTeamId: TEAM_ID,
        litellmUserId: USER_ID,
        dashboardTeamId: "team-a",
        models: ["claude-sonnet"],
      },
      CTX,
    );
    const body = fake.calls[0]!.body as Record<string, unknown>;
    for (const f of ["key", "allowed_routes", "permissions", "key_type"]) {
      expect(f in body, f).toBe(false);
    }
    expect(body.models).toEqual(["claude-sonnet"]);
    expect(body.user_id).toBe(USER_ID);
  });

  it("omits unset fields instead of sending 0 or null (LT10)", async () => {
    const { ops } = await load();
    await ops.createTeam!(
      { teamAlias: "Alpha", dashboardTeamId: "team-a" },
      CTX,
    );
    expect(fake.calls[0]!.body).toEqual({
      team_alias: "Alpha",
      metadata: META(),
    });
    await ops.setMemberLimits!(
      { litellmTeamId: TEAM_ID, litellmUserId: USER_ID, rpmLimit: 5 },
      CTX,
    );
    expect(fake.calls[1]!.body).toEqual({
      team_id: TEAM_ID,
      user_id: USER_ID,
      rpm_limit: 5,
    });
  });

  it("an Enterprise regenerate with no grace period sends an empty body, never new_key or ids", async () => {
    install({ edition: "enterprise" });
    const { ops } = await load({
      APP_ENV: "prod",
      LITELLM_ALLOWED_HOSTS: "litellm.test",
    });
    await ops.rotateKey!(
      {
        tokenId: TOKEN_A,
        litellmTeamId: TEAM_ID,
        litellmUserId: USER_ID,
        dashboardTeamId: "team-a",
      },
      CTX,
    );
    expect([undefined, {}]).toContainEqual(fake.calls[0]!.body);
  });

  it("OSS rotateKey composes generateMemberKey then blockKey on the old token, and never regenerate", async () => {
    const { ops } = await load();
    const result = (await ops.rotateKey!(
      {
        tokenId: TOKEN_A,
        litellmTeamId: TEAM_ID,
        litellmUserId: USER_ID,
        dashboardTeamId: "team-a",
      },
      CTX,
    )) as { key: string };
    expect(fake.calls.some((c) => c.path.endsWith("/regenerate"))).toBe(false);
    const writes = fake.calls.filter((c) => c.method === "POST");
    expect(writes.map((c) => c.path)).toEqual(["/key/generate", "/key/block"]);
    expect((writes[0]!.body as Record<string, unknown>).key).toBeUndefined();
    expect(writes[1]!.body).toEqual({ key: TOKEN_A });
    expect(result.key).toBe(NEW_KEY_VALUE);
  });
});

describe("generateMemberKey result", () => {
  it("returns the key value once, with its token id", async () => {
    const { ops } = await load();
    const result = (await ops.generateMemberKey!(
      {
        litellmTeamId: TEAM_ID,
        litellmUserId: USER_ID,
        dashboardTeamId: "team-a",
        models: ["claude-sonnet"],
      },
      CTX,
    )) as { key: string; tokenId: string };
    expect(result.key).toBe(NEW_KEY_VALUE);
    expect(result.tokenId).toBe(NEW_TOKEN);
  });
});

describe("addTeamMember never surfaces an auto-created key (LT17)", () => {
  it("the result lacks any key or upstream extra", async () => {
    install({ userExists: false });
    const { ops } = await load();
    const result = await ops.addTeamMember!(
      { litellmTeamId: TEAM_ID, email: "jane@company.com" },
      CTX,
    );
    const text = JSON.stringify(result ?? null);
    expect(text).not.toContain(AUTO_KEY_TRAP);
    expect(text).not.toContain("sk-");
  });
});

describe("disableMember touches only that member's keys in that team (LT7)", () => {
  it("blocks exactly the matching key, even when LiteLLM returns other rows", async () => {
    const { ops } = await load();
    await ops.disableMember!(
      { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
      CTX,
    );
    const blocks = fake.calls.filter((c) => c.path === "/key/block");
    expect(blocks.map((b) => (b.body as { key: string }).key)).toEqual([
      TOKEN_A,
    ]);
    expect(blocks.map((b) => (b.body as { key: string }).key)).not.toContain(
      TOKEN_B,
    );
    expect(fake.calls.map((c) => c.path)).not.toContain("/user/update");
  });

  it("does nothing but the lookup when the member owns no key in the team", async () => {
    install({
      keys: [{ token: TOKEN_B, team_id: OTHER_TEAM_ID, user_id: USER_ID }],
    });
    const { ops } = await load();
    await ops.disableMember!(
      { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
      CTX,
    );
    expect(fake.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("strict input schemas: unknown or forbidden fields are rejected before any call", () => {
  const BASE_INPUTS: Record<string, unknown> = {
    createTeam: { teamAlias: "Alpha", dashboardTeamId: "team-a" },
    setTeamBudget: { litellmTeamId: TEAM_ID, maxBudget: 1 },
    setTeamLimits: { litellmTeamId: TEAM_ID, rpmLimit: 1 },
    setTeamModels: { litellmTeamId: TEAM_ID, models: ["claude-sonnet"] },
    addTeamMember: { litellmTeamId: TEAM_ID, email: "jane@company.com" },
    removeTeamMember: { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
    setMemberBudget: {
      litellmTeamId: TEAM_ID,
      litellmUserId: USER_ID,
      maxBudgetInTeam: 1,
    },
    setMemberLimits: {
      litellmTeamId: TEAM_ID,
      litellmUserId: USER_ID,
      rpmLimit: 1,
    },
    resetMemberSpend: { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
    resetMemberBudget: { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
    disableMember: { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
    enableMember: { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
    generateMemberKey: {
      litellmTeamId: TEAM_ID,
      litellmUserId: USER_ID,
      dashboardTeamId: "team-a",
      models: ["claude-sonnet"],
    },
    updateMemberKey: { tokenId: TOKEN_A, keyAlias: "x" },
    blockKey: { tokenId: TOKEN_A },
    unblockKey: { tokenId: TOKEN_A },
    deleteKey: { tokenId: TOKEN_A },
    rotateKey: {
      tokenId: TOKEN_A,
      litellmTeamId: TEAM_ID,
      litellmUserId: USER_ID,
      dashboardTeamId: "team-a",
    },
  };
  const EXTRAS: Array<[string, Record<string, unknown>]> = [
    ["allowed_routes", { allowed_routes: ["/*"] }],
    ["allowedRoutes", { allowedRoutes: ["/*"] }],
    ["permissions", { permissions: { admin: true } }],
    ["user_role", { user_role: "proxy_admin" }],
    ["userRole", { userRole: "proxy_admin" }],
    ["key_type", { key_type: "llm_api" }],
    ["a key value", { key: "sk-attacker" }],
    ["changedBy", { changedBy: "llm-usage-lens:attacker" }],
    ["new_key", { new_key: "sk-x" }],
  ];

  for (const [name, input] of Object.entries(BASE_INPUTS)) {
    it.each(EXTRAS)(`${name} rejects %s with no call`, async (_n, extra) => {
      const { ops } = await load();
      await expect(
        ops[name]!({ ...(input as object), ...extra }, CTX),
      ).rejects.toThrow();
      expect(fake.calls).toHaveLength(0);
    });
  }

  it.each([
    ["an empty list (LiteLLM treats it as every model)", []],
    ["all-proxy-models", ["all-proxy-models"]],
    ["a wildcard", ["*"]],
    ["an empty name", [""]],
  ])(
    "models widening is rejected for team and key writes: %s",
    async (_n, models) => {
      const { ops } = await load();
      const common = {
        litellmTeamId: TEAM_ID,
        litellmUserId: USER_ID,
        dashboardTeamId: "team-a",
      };
      await expect(
        ops.setTeamModels!({ litellmTeamId: TEAM_ID, models }, CTX),
      ).rejects.toThrow();
      await expect(
        ops.createTeam!(
          { teamAlias: "A", dashboardTeamId: "team-a", models },
          CTX,
        ),
      ).rejects.toThrow();
      await expect(
        ops.generateMemberKey!({ ...common, models }, CTX),
      ).rejects.toThrow();
      await expect(
        ops.updateMemberKey!({ tokenId: TOKEN_A, models }, CTX),
      ).rejects.toThrow();
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("generateMemberKey requires user_id and a team (a key must have an owner)", async () => {
    const { ops } = await load();
    await expect(
      ops.generateMemberKey!(
        {
          litellmTeamId: TEAM_ID,
          dashboardTeamId: "team-a",
          models: ["claude-sonnet"],
        },
        CTX,
      ),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it("a token id that is not a hash is refused (never a key value)", async () => {
    const { ops } = await load();
    await expect(
      ops.blockKey!({ tokenId: "sk-live-key-value" }, CTX),
    ).rejects.toThrow();
    await expect(ops.getKey!({ tokenId: "../x" }, CTX)).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it("a write without an actor is refused with no call", async () => {
    const { ops } = await load();
    await expect(ops.blockKey!({ tokenId: TOKEN_A })).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });
});

describe("read inputs are bounded (Reads table)", () => {
  it.each([
    [
      "listKeys with neither team nor user",
      (o: Ops) => o.listKeys!({ page: 1, size: 10 }),
    ],
    [
      "listKeys with size 101",
      (o: Ops) => o.listKeys!({ litellmTeamId: TEAM_ID, size: 101 }),
    ],
    ["getUser without user_id", (o: Ops) => o.getUser!({})],
    // searchUsers bounds (Reads: search 2-100 chars trimmed, page_size <= 25; LT21)
    [
      "searchUsers with 1 character",
      (o: Ops) => o.searchUsers!({ search: "a" }),
    ],
    [
      "searchUsers with 1 character after trimming",
      (o: Ops) => o.searchUsers!({ search: "  a  " }),
    ],
    [
      "searchUsers with 101 characters",
      (o: Ops) => o.searchUsers!({ search: "a".repeat(101) }),
    ],
    [
      "searchUsers with page_size 26",
      (o: Ops) => o.searchUsers!({ search: "jane", pageSize: 26 }),
    ],
    [
      "searchUsers with an unknown field",
      (o: Ops) => o.searchUsers!({ search: "jane", userEmail: "x@y.com" }),
    ],
    [
      "searchUsers with a team that is not an id",
      (o: Ops) => o.searchUsers!({ search: "jane", litellmTeamId: "../x" }),
    ],
    [
      "getTeamDailySpend with both litellmTeamId and litellmTeamIds",
      (o: Ops) =>
        o.getTeamDailySpend!({
          litellmTeamId: TEAM_ID,
          litellmTeamIds: [OTHER_TEAM_ID],
          startDate: D1,
          endDate: D2,
        }),
    ],
    ["getKey without a token", (o: Ops) => o.getKey!({})],
    [
      "listSpendLogs without team or user",
      (o: Ops) => o.listSpendLogs!({ startDate: D1, endDate: D2 }),
    ],
    [
      "listSpendLogs with page_size 101",
      (o: Ops) =>
        o.listSpendLogs!({
          litellmTeamId: TEAM_ID,
          startDate: D1,
          endDate: D2,
          pageSize: 101,
        }),
    ],
    [
      "listSpendLogs over 90 days",
      (o: Ops) =>
        o.listSpendLogs!({
          litellmTeamId: TEAM_ID,
          startDate: "2026-01-01",
          endDate: D2,
        }),
    ],
    [
      "listProxyAuditLog over 90 days",
      (o: Ops) =>
        o.listProxyAuditLog!({ startDate: "2026-01-01", endDate: D2 }),
    ],
    [
      "listProxyAuditLog with a table outside the three allowed",
      (o: Ops) =>
        o.listProxyAuditLog!({
          startDate: D1,
          endDate: D2,
          tableName: "LiteLLM_ProxyModelTable",
        }),
    ],
    [
      "listProxyAuditLog with page_size 101",
      (o: Ops) =>
        o.listProxyAuditLog!({ startDate: D1, endDate: D2, pageSize: 101 }),
    ],
    [
      "getTeamDailySpend with end before start",
      (o: Ops) =>
        o.getTeamDailySpend!({
          litellmTeamId: TEAM_ID,
          startDate: D2,
          endDate: D1,
        }),
    ],
    [
      "a read with an unknown field",
      (o: Ops) => o.getTeam!({ litellmTeamId: TEAM_ID, path: "/team/delete" }),
    ],
  ])("%s is rejected with no call", async (_n, run) => {
    const { ops } = await load();
    await expect(run(ops)).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  // Source: docs/specs/2026-11-10-litellm.md "Reads" (getTeamDailySpend
  // team_ids), L3b review nit: an oversized list is refused with a message
  // naming the limit, not a bare schema error.
  it("getTeamDailySpend with 201 team ids is rejected naming the 200-team limit, no call", async () => {
    const { ops } = await load();
    const ids = Array.from(
      { length: 201 },
      (_, i) => `${String(i).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    );
    await expect(
      ops.getTeamDailySpend!({
        litellmTeamIds: ids,
        startDate: D1,
        endDate: D2,
      }),
    ).rejects.toThrow(/at most 200 teams/i);
    expect(fake.calls).toHaveLength(0);
  });

  it("listKeys accepts a user-only filter", async () => {
    const { ops } = await load();
    await ops.listKeys!({ litellmUserId: USER_ID });
    expect(q(fake.calls[0]!).user_id).toBe(USER_ID);
    expect(q(fake.calls[0]!).team_id).toBeUndefined();
  });
});

describe("searchUsers response (Reads: rows reduced; L3b)", () => {
  const row = {
    user_id: "uid-1",
    user_email: "jane@company.com",
    spend: 2.5,
    max_budget: 9,
    teams: [TEAM_ID],
    sso_user_id: "SECRET-HASH-SENTINEL",
    metadata: { note: "USERTEAM-SENTINEL" },
  };

  it("is reduced to user_id, user_email, spend, max_budget and team ids", async () => {
    fake.setHandler(() => ({
      status: 200,
      body: { users: [row], total: 1, page: 1, page_size: 25, total_pages: 1 },
    }));
    const { ops } = await load();
    const result = (await ops.searchUsers!({ search: "jane" })) as {
      users: unknown[];
    };
    expect(result.users).toEqual([
      {
        user_id: "uid-1",
        user_email: "jane@company.com",
        spend: 2.5,
        max_budget: 9,
        teams: [TEAM_ID],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("SENTINEL");
  });

  it("a malformed answer is contract drift: LITELLM_UNAVAILABLE", async () => {
    fake.setHandler(() => ({ status: 200, body: { nope: true } }));
    const { ops } = await load();
    await expect(ops.searchUsers!({ search: "jane" })).rejects.toMatchObject({
      code: "LITELLM_UNAVAILABLE",
    });
  });
});

describe("responses are Zod-parsed", () => {
  it.each([
    ["a string", "SENTINEL-NOT-AN-OBJECT"],
    ["an array", ["SENTINEL"]],
    ["a number", 7],
  ])(
    "a malformed /team/info answer (%s) is contract drift: LITELLM_UNAVAILABLE, nothing leaked",
    async (_n, body) => {
      fake.setHandler(() => ({ status: 200, body }));
      const { ops } = await load();
      const err = await ops.getTeam!({ litellmTeamId: TEAM_ID }).catch(
        (e: unknown) => e,
      );
      expect(err).toMatchObject({ code: "LITELLM_UNAVAILABLE" });
      expect(String((err as Error).message)).not.toContain("SENTINEL");
    },
  );

  it("a user list missing its required fields is contract drift", async () => {
    fake.setHandler(() => ({ status: 200, body: { nope: true } }));
    const { ops } = await load();
    await expect(
      ops.findUserByEmail!({ email: "jane@company.com" }),
    ).rejects.toMatchObject({ code: "LITELLM_UNAVAILABLE" });
  });

  it("the audit view drops before_value, updated_values and changed_by_api_key at parsing (Audit item 3)", async () => {
    const { ops } = await load();
    const result = await ops.listProxyAuditLog!({ startDate: D1, endDate: D2 });
    const text = JSON.stringify(result);
    expect(text).not.toContain("SECRET-HASH-SENTINEL");
    expect(text).not.toContain("before_value");
    expect(text).not.toContain("updated_values");
    expect(text).not.toContain("changed_by_api_key");
    expect(text).toContain("llm-usage-lens:jane@company.com");
  });
});

// Source: docs/specs/2026-11-10-litellm.md — the `rotateKey` row (OSS
// carry-over, L2 review 2026-11-15: team_id/user_id must match or the
// rotation is refused with no write; `models` carried exactly, any
// unparseable old model refuses as contract drift with no write; expiry and
// blocked state carried), "Security architecture" item 2 (gate order: toggle
// -> edition -> input validation), "Gateway guardrails" item 4, threats LT4,
// LT7, LT14; Rule 60.17 (no silent failures).
describe("L2 review carry-overs: rotateKey, generateMemberKey, memberKeyTokens", () => {
  const REVIEW_NOW = "2026-11-14T10:00:00.000Z";
  const REVIEW_CTX = {
    actor: { oid: "oid-actor-1", email: "admin@company.com" },
  };
  const loadOps = async (): Promise<Ops> => (await load()).ops;
  const writes = () => fake.calls.filter((c) => c.method === "POST");

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(REVIEW_NOW));
    await clearTable();
    await storeConnection();
    install();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const ROTATE_BASE = {
    litellmTeamId: TEAM_ID,
    litellmUserId: USER_ID,
    dashboardTeamId: "team-a",
  };
  const ROTATE = {
    tokenId: TOKEN_A,
    litellmTeamId: TEAM_ID,
    litellmUserId: USER_ID,
    dashboardTeamId: "team-a",
  };

  describe("OSS rotateKey carries the old key's models exactly (LT4, LT14)", () => {
    it("the new key's models are the old key's list, in order", async () => {
      install({
        keyInfo: { models: ["claude-sonnet", "claude-haiku"] },
        teamModels: ["claude-sonnet", "claude-haiku"],
        proxyModels: ["claude-sonnet", "claude-haiku"],
      });
      const ops = await loadOps();
      await ops.rotateKey!(ROTATE, REVIEW_CTX);
      const generate = writes().find((c) => c.path === "/key/generate")!;
      expect((generate.body as { models?: unknown }).models).toEqual([
        "claude-sonnet",
        "claude-haiku",
      ]);
    });

    it.each([
      ["one bad name among good ones", ["claude-sonnet", "bad name!"]],
      ["a widening name among good ones", ["claude-sonnet", "all-team-models"]],
      ["every name unparseable", ["bad name!", "also/../bad name"]],
      ["an over-long name", ["a".repeat(201)]],
    ])(
      "refuses as contract drift with no write when the old models contain %s",
      async (_n, models) => {
        install({ keyInfo: { models } });
        const ops = await loadOps();
        const err = await ops.rotateKey!(ROTATE, REVIEW_CTX).catch(
          (e: unknown) => e,
        );
        expect(err).toMatchObject({
          code: "LITELLM_UNAVAILABLE",
          detail: "contract_drift",
        });
        expect(writes()).toHaveLength(0);
      },
    );
  });

  describe("OSS rotateKey carries expiry and blocked state, and checks ownership", () => {
    it("the new key takes the old key's remaining lifetime", async () => {
      install({
        keyInfo: {
          models: ["claude-sonnet"],
          expires: "2026-12-14T10:00:00.000Z",
        },
      });
      const ops = await loadOps();
      await ops.rotateKey!(ROTATE, REVIEW_CTX);
      const generate = writes().find((c) => c.path === "/key/generate")!;
      // 30 days from the frozen clock, in any whole unit the Duration schema allows.
      expect((generate.body as { duration?: string }).duration).toMatch(
        /^(30d|720h)$/,
      );
    });

    it("a key without an expiry gives the new key no duration", async () => {
      install({ keyInfo: { models: ["claude-sonnet"], expires: null } });
      const ops = await loadOps();
      await ops.rotateKey!(ROTATE, REVIEW_CTX);
      const generate = writes().find((c) => c.path === "/key/generate")!;
      expect(
        (generate.body as { duration?: unknown }).duration,
      ).toBeUndefined();
    });

    it("a blocked old key: generate (no `blocked` in the body), block the new key, then block the old key (rotateKey row, LT4)", async () => {
      install({ keyInfo: { models: ["claude-sonnet"], blocked: true } });
      const ops = await loadOps();
      await ops.rotateKey!(ROTATE, REVIEW_CTX);
      const sequence = writes().map((c) => [
        c.path,
        (c.body as { key?: string }).key,
      ]);
      expect(sequence).toEqual([
        ["/key/generate", undefined],
        ["/key/block", NEW_TOKEN],
        ["/key/block", TOKEN_A],
      ]);
      expect("blocked" in (writes()[0]!.body as Record<string, unknown>)).toBe(
        false,
      );
    });

    it("an unblocked old key does not mark the new key blocked", async () => {
      install({ keyInfo: { models: ["claude-sonnet"], blocked: false } });
      const ops = await loadOps();
      await ops.rotateKey!(ROTATE, REVIEW_CTX);
      const generate = writes().find((c) => c.path === "/key/generate")!;
      expect([undefined, false]).toContainEqual(
        (generate.body as { blocked?: unknown }).blocked,
      );
    });

    it.each([
      ["another team", { team_id: OTHER_TEAM_ID }],
      ["another user", { user_id: OTHER_USER_ID }],
      ["no team", { team_id: null }],
    ])(
      "refuses with no write when the old key belongs to %s",
      async (_n, owner) => {
        install({ keyInfo: { models: ["claude-sonnet"], ...owner } });
        const ops = await loadOps();
        await expect(ops.rotateKey!(ROTATE, REVIEW_CTX)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        expect(writes()).toHaveLength(0);
      },
    );
  });

  // rotateKey row (spec audit 2026-11-15): expiry is the remaining life rounded
  // DOWN to the duration unit, capped at the ceiling; no expiry stays none.
  describe("OSS rotateKey expiry rounds down and is capped (rotateKey row)", () => {
    const duration = async (expires: string) => {
      install({ keyInfo: { models: ["claude-sonnet"], expires } });
      const ops = await loadOps();
      await ops.rotateKey!(ROTATE, REVIEW_CTX);
      return (
        writes().find((c) => c.path === "/key/generate")!.body as {
          duration?: string;
        }
      ).duration;
    };

    it.each([
      [
        "30 days 12 hours left is 30d, not 31d",
        "2026-12-14T22:00:00.000Z",
        "30d",
      ],
      [
        "1 hour 30 minutes left is 1h, not 2h",
        "2026-11-14T11:30:00.000Z",
        "1h",
      ],
    ])("%s", async (_n, expires, expected) => {
      const got = await duration(expires);
      expect(got).toBe(expected);
    });

    it("a life beyond the 4-digit duration ceiling is capped at 9999d", async () => {
      expect(await duration("2100-01-01T00:00:00.000Z")).toBe("9999d");
    });
  });

  // rotateKey row: the copied models are re-checked against the current team
  // models and /models (LT14); a mismatch is 409 CONFLICT with no write.
  describe("OSS rotateKey re-checks the copied models (LT14)", () => {
    it.each([
      [
        "a model the team no longer has",
        {
          teamModels: ["claude-sonnet"],
          proxyModels: ["claude-sonnet", "claude-opus"],
        },
      ],
      [
        "a model the proxy no longer lists",
        {
          teamModels: ["claude-sonnet", "claude-opus"],
          proxyModels: ["claude-sonnet"],
        },
      ],
    ])(
      "refuses with 409 CONFLICT and no write when the old key has %s",
      async (_n, drift) => {
        install({
          keyInfo: { models: ["claude-sonnet", "claude-opus"] },
          ...drift,
        });
        const ops = await loadOps();
        await expect(ops.rotateKey!(ROTATE, REVIEW_CTX)).rejects.toMatchObject({
          code: "CONFLICT",
        });
        expect(writes()).toHaveLength(0);
      },
    );
  });

  // Writes table + LT4: `blocked` is no field of the /key/generate builder.
  describe("generateMemberKey does not accept `blocked` (LT4)", () => {
    it("rejects it with no call", async () => {
      const ops = await loadOps();
      await expect(
        ops.generateMemberKey!(
          { ...ROTATE_BASE, models: ["claude-sonnet"], blocked: true },
          REVIEW_CTX,
        ),
      ).rejects.toThrow();
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe("memberKeyTokens (disableMember / enableMember)", () => {
    const MEMBER = { litellmTeamId: TEAM_ID, litellmUserId: USER_ID };

    it.each(["disableMember", "enableMember"])(
      "%s throws instead of silently truncating when LiteLLM never reaches the last page (100-page cap)",
      async (name) => {
        const base = gatewayHandler();
        fake.setHandler((call, n) => {
          if (call.method === "GET" && call.path === "/key/list") {
            return {
              status: 200,
              body: {
                keys: [{ token: TOKEN_A, team_id: TEAM_ID, user_id: USER_ID }],
                total_count: 100_000,
                current_page: 1,
                total_pages: 1000,
              },
            };
          }
          return base(call, n);
        });
        const ops = await loadOps();
        await expect(ops[name]!(MEMBER, REVIEW_CTX)).rejects.toBeDefined();
        expect(
          fake.calls.filter((c) => c.path === "/key/list").length,
        ).toBeLessThanOrEqual(100);
        expect(writes()).toHaveLength(0);
      },
    );

    it("exactly 100 pages that end on the last page is not an error", async () => {
      const base = gatewayHandler();
      fake.setHandler((call, n) => {
        if (call.method === "GET" && call.path === "/key/list") {
          return {
            status: 200,
            body: {
              keys: [],
              total_count: 0,
              current_page: 1,
              total_pages: 100,
            },
          };
        }
        return base(call, n);
      });
      const ops = await loadOps();
      await expect(ops.disableMember!(MEMBER, REVIEW_CTX)).resolves.toEqual({
        tokenIds: [],
      });
    });

    it("a matching row whose token is not a token hash is contract drift (LITELLM_UNAVAILABLE), not a raw validation error", async () => {
      install({
        keys: [{ token: "sk-not-a-hash", team_id: TEAM_ID, user_id: USER_ID }],
      });
      const ops = await loadOps();
      const err = await ops.disableMember!(MEMBER, REVIEW_CTX).catch(
        (e: unknown) => e,
      );
      expect(err).toMatchObject({
        code: "LITELLM_UNAVAILABLE",
        detail: "contract_drift",
      });
      expect((err as Error).name).toBe("LiteLLMError");
      expect(writes()).toHaveLength(0);
    });
  });
});

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage (L6)
// -> LiteLLM reads used" (Paging fix: /user/daily/activity pages by `page` and
// `page_size` <= 1000 and says so in metadata.has_more; L6 sends page_size=1000
// and loops while has_more, at most 10 pages; beyond that the read returns 503
// LITELLM_UNAVAILABLE, never a partial sum; /team/daily/activity/aggregated has
// no paging and is unchanged), LT34, LD35 precedent.
//
// Contract: getUserDailySpend resolves { results: <all pages' rows in page
// order>, metadata }; it rejects with a LiteLLMError (code LITELLM_UNAVAILABLE)
// on the cap or on any failed page.
describe("getUserDailySpend paging (LT34)", () => {
  const RANGE_INPUT = { litellmUserId: USER_ID, startDate: D1, endDate: D2 };

  // Page n answers one row of spend n; has_more while n < total (or always).
  function pagedFake(total: number, opts: { endless?: boolean } = {}) {
    fake = createFakeLiteLLM((call) => {
      if (call.path !== "/user/daily/activity") {
        return { status: 404, body: { detail: "not found" } };
      }
      const page = Number(new URL(call.url).searchParams.get("page") ?? "1");
      return {
        status: 200,
        body: {
          results: [{ date: D1, metrics: { spend: page } }],
          metadata: { page, has_more: opts.endless === true || page < total },
        },
      };
    });
    vi.stubGlobal("fetch", fake.fetch);
  }
  const pagesRequested = () =>
    fake.calls.map((c) => new URL(c.url).searchParams.get("page"));

  it("follows has_more: one request per page with page_size 1000, rows concatenated in page order", async () => {
    pagedFake(3);
    const { ops } = await load();
    const out = (await ops.getUserDailySpend!(RANGE_INPUT)) as {
      results: Array<{ metrics: { spend: number } }>;
    };
    expect(pagesRequested()).toEqual(["1", "2", "3"]);
    for (const c of fake.calls) {
      expect(q(c).page_size).toBe("1000");
      expect(q(c).user_id).toBe(USER_ID);
      expect(q(c).timezone).toBe("0");
    }
    expect(out.results.map((r) => r.metrics.spend)).toEqual([1, 2, 3]);
  });

  it("stops after one request when has_more is false or absent", async () => {
    install();
    const { ops } = await load();
    await ops.getUserDailySpend!(RANGE_INPUT);
    expect(fake.calls).toHaveLength(1);
  });

  it("accepts exactly 10 pages", async () => {
    pagedFake(10);
    const { ops } = await load();
    const out = (await ops.getUserDailySpend!(RANGE_INPUT)) as {
      results: unknown[];
    };
    expect(fake.calls).toHaveLength(10);
    expect(out.results).toHaveLength(10);
  });

  it("an 11th page is never requested: 503 LITELLM_UNAVAILABLE after the 10th says has_more", async () => {
    pagedFake(11);
    const { ops } = await load();
    await expect(ops.getUserDailySpend!(RANGE_INPUT)).rejects.toMatchObject({
      code: "LITELLM_UNAVAILABLE",
    });
    expect(fake.calls).toHaveLength(10);
  });

  it("an endless has_more also stops at 10 requests", async () => {
    pagedFake(1, { endless: true });
    const { ops } = await load();
    await expect(ops.getUserDailySpend!(RANGE_INPUT)).rejects.toMatchObject({
      code: "LITELLM_UNAVAILABLE",
    });
    expect(fake.calls).toHaveLength(10);
  });

  it("a failed later page rejects the whole read: no partial sum", async () => {
    fake = createFakeLiteLLM((call) => {
      const page = Number(new URL(call.url).searchParams.get("page") ?? "1");
      return page === 1
        ? {
            status: 200,
            body: {
              results: [{ date: D1, metrics: { spend: 1 } }],
              metadata: { has_more: true },
            },
          }
        : { status: 500, body: { detail: "boom" } };
    });
    vi.stubGlobal("fetch", fake.fetch);
    const { ops } = await load();
    await expect(ops.getUserDailySpend!(RANGE_INPUT)).rejects.toMatchObject({
      code: "LITELLM_UNAVAILABLE",
    });
  });

  it("getTeamDailySpend is unchanged: no page or page_size", async () => {
    install();
    const { ops } = await load();
    await ops.getTeamDailySpend!({
      litellmTeamId: TEAM_ID,
      startDate: D1,
      endDate: D2,
    });
    expect(q(fake.calls[0]!)).not.toHaveProperty("page");
    expect(q(fake.calls[0]!)).not.toHaveProperty("page_size");
  });
});
