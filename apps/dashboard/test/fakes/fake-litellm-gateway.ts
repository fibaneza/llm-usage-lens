import type { FakeCall, FakeHandler, FakeReply } from "./fake-litellm";

// Test-only canned LiteLLM 1.109.1 answers for the L2 gateway tests (Rule
// 60.24: in-process, no network). Shapes follow docs/litellm/openapi.json
// (required fields of the response schemas); the keys/ids are fixtures.
// `edition` models the two LiteLLM editions: Enterprise-only routes answer
// 500 (regenerate) / 403 on OSS, exactly the surface the edition gate must
// never reach. Not imported by production code.
export const TEAM_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_TEAM_ID = "22222222-2222-4222-8222-222222222222";
export const USER_ID = "jane@company.com";
export const OTHER_USER_ID = "bob@company.com";
export const TOKEN_A = "a".repeat(64);
export const TOKEN_B = "b".repeat(64);
export const TOKEN_C = "c".repeat(64);
export const NEW_TOKEN = "d".repeat(64);
export const NEW_KEY_VALUE = "sk-NEW-KEY-VALUE-SENTINEL";
export const AUTO_KEY_TRAP = "sk-AUTOCREATED-TRAP";

export type GatewayFakeOptions = {
  edition?: "oss" | "enterprise";
  // Whether `GET /user/list?user_email=` finds the user.
  userExists?: boolean;
  userRole?: string;
  // Rows returned by GET /key/list regardless of the query, so tests prove
  // the gateway re-checks ownership itself.
  keys?: Array<{ token: string; team_id: string | null; user_id: string }>;
  // Fields merged over the GET /key/info `info` object (models, expires,
  // blocked, team_id, user_id, limits), so rotation tests control the old key.
  keyInfo?: Record<string, unknown>;
  // The team's `models` on GET /team/info and the names GET /models lists
  // (default ["claude-sonnet"] for both), so rotation tests can drift them.
  teamModels?: string[];
  proxyModels?: string[];
};

const DEFAULT_KEYS = [
  { token: TOKEN_A, team_id: TEAM_ID, user_id: USER_ID },
  { token: TOKEN_B, team_id: TEAM_ID, user_id: OTHER_USER_ID },
  { token: TOKEN_C, team_id: OTHER_TEAM_ID, user_id: USER_ID },
];

export function gatewayHandler(opts: GatewayFakeOptions = {}): FakeHandler {
  const edition = opts.edition ?? "oss";
  const keys = opts.keys ?? DEFAULT_KEYS;
  return (call: FakeCall): FakeReply => {
    const route = `${call.method} ${call.path}`;
    const q = new URL(call.url).searchParams;
    switch (route) {
      case "GET /team/info":
        return {
          status: 200,
          body: {
            team_id: q.get("team_id"),
            team_info: {
              team_id: q.get("team_id"),
              team_alias: "Alpha",
              max_budget: 100,
              spend: 12.5,
              models: opts.teamModels ?? ["claude-sonnet"],
              members_with_roles: [
                { user_id: USER_ID, user_email: USER_ID, role: "user" },
              ],
            },
            keys: [],
            team_memberships: [],
          },
        };
      case "GET /team/list":
        return {
          status: 200,
          body: [{ team_id: TEAM_ID, team_alias: "Alpha" }],
        };
      case "GET /team/daily/activity/aggregated":
      case "GET /user/daily/activity":
        return { status: 200, body: { results: [], metadata: {} } };
      case "GET /user/info":
        return {
          status: 200,
          body: {
            user_id: q.get("user_id"),
            user_info: {
              user_id: q.get("user_id"),
              user_email: q.get("user_id"),
              user_role: opts.userRole ?? "internal_user",
              spend: 1,
            },
            keys: [],
            teams: [],
          },
        };
      case "GET /user/list":
        return {
          status: 200,
          body: {
            users:
              (opts.userExists ?? true)
                ? [
                    {
                      user_id: q.get("user_email") ?? USER_ID,
                      user_email: q.get("user_email") ?? USER_ID,
                      user_role: opts.userRole ?? "internal_user",
                    },
                  ]
                : [],
            total: opts.userExists === false ? 0 : 1,
            page: 1,
            page_size: 25,
            total_pages: 1,
          },
        };
      case "GET /key/list":
        return {
          status: 200,
          body: {
            keys,
            total_count: keys.length,
            current_page: 1,
            total_pages: 1,
          },
        };
      case "GET /key/info":
        return {
          status: 200,
          body: {
            key: q.get("key"),
            info: {
              token: q.get("key"),
              team_id: TEAM_ID,
              user_id: USER_ID,
              ...opts.keyInfo,
            },
          },
        };
      case "GET /spend/logs/v2":
        return {
          status: 200,
          body: { data: [], total: 0, page: 1, page_size: 25, total_pages: 0 },
        };
      case "GET /models":
        return {
          status: 200,
          body: {
            data: (opts.proxyModels ?? ["claude-sonnet"]).map((id) => ({
              id,
              object: "model",
            })),
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
                object_id: TEAM_ID,
                before_value: { max_budget: 1 },
                updated_values: { max_budget: 2 },
              },
            ],
            total: 1,
            page: 1,
            page_size: 25,
            total_pages: 1,
          },
        };
      case "GET /global/spend/report":
        return edition === "enterprise"
          ? { status: 200, body: [] }
          : { status: 403, body: { detail: "enterprise only" } };
      case "POST /team/new":
        return { status: 200, body: { team_id: TEAM_ID, team_alias: "Alpha" } };
      case "POST /team/update":
        return { status: 200, body: { team_id: TEAM_ID } };
      case "POST /user/new":
        // `key: null` as the contract requires the field; the trap below
        // proves the gateway never surfaces an auto-created key (LT17).
        return {
          status: 200,
          body: {
            user_id: (call.body as { user_id?: string }).user_id,
            user_email: (call.body as { user_email?: string }).user_email,
            key: null,
            trap: AUTO_KEY_TRAP,
          },
        };
      case "POST /team/member_add":
        return {
          status: 200,
          body: {
            team_id: TEAM_ID,
            updated_users: [],
            updated_team_memberships: [],
          },
        };
      case "POST /team/member_update":
        return { status: 200, body: { user_id: USER_ID, team_id: TEAM_ID } };
      case "POST /team/member_delete":
        return { status: 200, body: {} };
      case "POST /key/generate":
        return {
          status: 200,
          body: { key: NEW_KEY_VALUE, token: NEW_TOKEN, token_id: NEW_TOKEN },
        };
      case "POST /key/update":
      case "POST /key/delete":
        return { status: 200, body: {} };
      case "POST /key/block":
      case "POST /key/unblock":
        return {
          status: 200,
          body: { token: (call.body as { key?: string }).key },
        };
      default:
        break;
    }
    if (/^POST \/team\/[^/]+\/member\/[^/]+\/reset_spend$/.test(route)) {
      return { status: 200, body: {} };
    }
    if (/^POST \/team\/[^/]+\/member\/[^/]+\/reset_budget$/.test(route)) {
      return {
        status: 200,
        body: {
          team_id: TEAM_ID,
          user_id: USER_ID,
          budget_id: "b2",
          previous_budget_id: "b1",
          budget_source: "team_default",
        },
      };
    }
    if (/^POST \/key\/[^/]+\/regenerate$/.test(route)) {
      return edition === "enterprise"
        ? {
            status: 200,
            body: { key: NEW_KEY_VALUE, token: NEW_TOKEN, token_id: NEW_TOKEN },
          }
        : { status: 500, body: { detail: "enterprise only" } };
    }
    return { status: 404, body: { detail: "not found" } };
  };
}
