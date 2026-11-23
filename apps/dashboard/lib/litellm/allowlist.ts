import "server-only";

import type { LiteLLMOperationName } from "@llm-usage-lens/shared";

// Source: docs/specs/2026-11-10-litellm.md — "Allowlist (the gateway)" (one
// typed function per row; Reads and Writes tables), decision LD10 (toggle
// defaults), "Service key `allowed_routes`" (the list below equals the spec's
// and the runbook's, as written, including the two temporary wildcards of
// LD4), "Edition" (Enterprise-only routes), "Gateway guardrails" items 1-3.
// The table is code: configuration can only narrow it (LD19), never add to it.

export type LiteLLMMethod = "GET" | "POST";

export type AllowlistedRoute = {
  readonly method: LiteLLMMethod;
  readonly template: string;
  // Refused on OSS before any request (LT15).
  readonly enterpriseOnly?: true;
};

export type OperationDefinition = {
  readonly kind: "read" | "write";
  // LD10 default; the config file and saved toggles may only switch it off or
  // on for an operation already in this table.
  readonly defaultEnabled: boolean;
  readonly routes: readonly AllowlistedRoute[];
  // Refused on Enterprise before any request: the person is created by LiteLLM
  // at SSO sign-in (LiteLLM spec - `createUser`, OSS only).
  readonly ossOnly?: true;
};

const get = (template: string, enterpriseOnly?: true): AllowlistedRoute =>
  enterpriseOnly
    ? { method: "GET", template, enterpriseOnly }
    : { method: "GET", template };
const post = (template: string, enterpriseOnly?: true): AllowlistedRoute =>
  enterpriseOnly
    ? { method: "POST", template, enterpriseOnly }
    : { method: "POST", template };

const RESET_SPEND = "/team/{team_id}/member/{user_id}/reset_spend";
const RESET_BUDGET = "/team/{team_id}/member/{user_id}/reset_budget";
const REGENERATE = "/key/{key}/regenerate";

const read = (...routes: AllowlistedRoute[]): OperationDefinition => ({
  kind: "read",
  defaultEnabled: true,
  routes,
});
const write = (
  defaultEnabled: boolean,
  ...routes: AllowlistedRoute[]
): OperationDefinition => ({ kind: "write", defaultEnabled, routes });

export const LITELLM_OPERATIONS = {
  getTeam: read(get("/team/info")),
  listProxyTeams: read(get("/team/list")),
  getTeamDailySpend: read(get("/team/daily/activity/aggregated")),
  getUser: read(get("/user/info")),
  findUserByEmail: read(get("/user/list")),
  searchUsers: read(get("/user/list")),
  getUserDailySpend: read(get("/user/daily/activity")),
  listKeys: read(get("/key/list")),
  getKey: read(get("/key/info")),
  listSpendLogs: read(get("/spend/logs/v2")),
  listProxyModels: read(get("/models")),
  listProxyAuditLog: read(get("/audit")),
  getGlobalSpendReport: read(get("/global/spend/report", true)),
  createTeam: write(true, post("/team/new")),
  setTeamBudget: write(true, post("/team/update")),
  setTeamLimits: write(true, post("/team/update")),
  setTeamModels: write(true, post("/team/update")),
  addTeamMember: write(
    true,
    get("/user/list"),
    post("/user/new"),
    post("/team/member_add"),
  ),
  createUser: {
    ...write(true, get("/user/list"), post("/user/new")),
    ossOnly: true,
  },
  removeTeamMember: write(true, post("/team/member_delete")),
  setMemberBudget: write(true, post("/team/member_update")),
  setMemberLimits: write(true, post("/team/member_update")),
  resetMemberSpend: write(false, post(RESET_SPEND)),
  resetMemberBudget: write(true, post(RESET_BUDGET)),
  resetUserSpend: write(false, post("/user/update")),
  disableMember: write(true, get("/key/list"), post("/key/block")),
  enableMember: write(true, get("/key/list"), post("/key/unblock")),
  generateMemberKey: write(true, post("/key/generate")),
  updateMemberKey: write(true, post("/key/update")),
  blockKey: write(true, post("/key/block")),
  unblockKey: write(true, post("/key/unblock")),
  deleteKey: write(false, post("/key/delete")),
  rotateKey: write(
    true,
    post("/key/generate"),
    post("/key/block"),
    post(REGENERATE, true),
  ),
  // MG-D11a: a dashboard-only operation (no LiteLLM route); a request alone
  // changes nothing in LiteLLM, hence on by default.
  requestBudgetReset: write(true),
} as const satisfies Record<LiteLLMOperationName, OperationDefinition>;

const ROUTE_INDEX: ReadonlyMap<string, AllowlistedRoute> = new Map(
  Object.values(LITELLM_OPERATIONS).flatMap((op) =>
    op.routes.map((r): [string, AllowlistedRoute] => [
      `${r.method} ${r.template}`,
      r,
    ]),
  ),
);

export function findAllowlistedRoute(
  method: string,
  template: string,
): AllowlistedRoute | undefined {
  return ROUTE_INDEX.get(`${method} ${template}`);
}

// Strict path-parameter patterns (Gateway guardrails item 2): no `/`, `..`,
// `?`, `#`, `%`, whitespace or control characters. `{key}` is always a token
// hash (never a key value).
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9@._+:-]{0,255}$/;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;

export const PATH_PARAM_PATTERNS = {
  team_id: ID_PATTERN,
  user_id: ID_PATTERN,
  key: TOKEN_HASH_PATTERN,
} as const;

export function isValidPathParam(name: string, value: string): boolean {
  if (!(name in PATH_PARAM_PATTERNS)) return false;
  const pattern = PATH_PARAM_PATTERNS[name as keyof typeof PATH_PARAM_PATTERNS];
  return pattern.test(value) && !value.includes("..");
}

export function isValidLiteLLMId(value: string): boolean {
  return ID_PATTERN.test(value) && !value.includes("..");
}

export const TOKEN_HASH_RE = TOKEN_HASH_PATTERN;

// Equal to the spec's "Service key `allowed_routes`" block and the runbook's
// §3 list (LT3). `/team/*` and `/key/*` are temporary (LD4).
export const LITELLM_SERVICE_KEY_ALLOWED_ROUTES: readonly string[] = [
  "/team/new",
  "/team/update",
  "/team/info",
  "/team/list",
  "/team/member_add",
  "/team/member_update",
  "/team/member_delete",
  "/team/*",
  "/team/daily/activity/aggregated",
  "/user/new",
  "/user/info",
  "/user/list",
  "/user/update",
  "/user/daily/activity",
  "/key/generate",
  "/key/update",
  "/key/delete",
  "/key/block",
  "/key/unblock",
  "/key/info",
  "/key/list",
  "/key/*",
  "/spend/logs/v2",
  "/models",
  "/global/spend/report",
  "/audit",
];
