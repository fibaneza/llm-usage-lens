import "server-only";

import { UtcDaySchema, liteLLMEdition } from "@llm-usage-lens/shared";
import type { LiteLLMOperationName } from "@llm-usage-lens/shared";
import { z } from "zod";

import { env } from "@/env";
import { getOperationToggles } from "@/lib/data/litellm/toggles";

import {
  LITELLM_OPERATIONS,
  TOKEN_HASH_RE,
  isValidLiteLLMId,
} from "./allowlist";
import { LiteLLMError } from "./client";
import { callAllowlisted } from "./gateway";
import type { LiteLLMActor } from "./gateway";
import { LiteLLMActorSchema, LiteLLMOperationRefused } from "./gateway";
import { loadGatewayConfig } from "./gateway-config";
import { resolveOperationSettings } from "./operation-settings";

// Source: docs/specs/2026-11-10-litellm.md — "Allowlist (the gateway)": one
// typed function per row with a fixed method and path; a strict Zod input
// schema builds the body from typed, server-resolved values (never a forwarded
// client body; unknown fields rejected); every response is Zod-parsed (a
// mismatch is contract drift: LITELLM_UNAVAILABLE). "Reads" and "Writes"
// tables (the only query and body fields), "Toggles narrow only" and
// "Guardrail configuration" (a disabled operation, read or write, returns 403
// OPERATION_DISABLED before any call), "Edition" (LT15), "Gateway guardrails"
// item 4 (exact bodies, LT4), "Audit" item 3 (the audit view drops
// before_value, updated_values and changed_by_api_key), threats LT4, LT7,
// LT10, LT17, LT19. Contract snapshot: docs/litellm/openapi.json (1.109.1).
// Authorization (`can()`), scope and the privileged-target check are the
// callers' job (L3/L4); this module is the typed allowlist behind them.

// ---- shared input pieces --------------------------------------------------

const LiteLLMId = z.string().refine(isValidLiteLLMId, "Invalid id");
const TokenId = z.string().regex(TOKEN_HASH_RE, "Expected a key token hash");
const DashboardTeamId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+$/);
const Budget = z.number().finite().min(0);
const Limit = z.number().int().min(0);
const Duration = z.string().regex(/^\d{1,4}(s|m|h|d|w|mo)$/);
const KeyAlias = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[\x20-\x7e]+$/);
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
// Names that make LiteLLM treat a list as "every model" (LT4).
const WIDENING_MODELS: ReadonlySet<string> = new Set([
  "all-proxy-models",
  "all-team-models",
]);
const ModelName = z
  .string()
  .regex(MODEL_RE)
  .refine((n) => !WIDENING_MODELS.has(n), "Model list would widen access");
// An empty list means every model to LiteLLM, so it is refused (LT4).
const Models = z.array(ModelName).min(1).max(200);
const ModelLimits = z.record(z.string().regex(MODEL_RE), Limit);
const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const PageNumber = z.number().int().min(1).max(10_000);
const PageSize = z.number().int().min(1).max(100);

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 90;
const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);

function withRange<S extends z.ZodType<{ startDate: string; endDate: string }>>(
  schema: S,
  maxDays?: number,
) {
  return schema.refine((v) => {
    const span = dayMs(v.endDate) - dayMs(v.startDate);
    return span >= 0 && (maxDays === undefined || span / DAY_MS < maxDays);
  }, "Invalid date range");
}

function atLeastOne<S extends z.ZodType<Record<string, unknown>>>(
  schema: S,
  ignore: readonly string[],
) {
  return schema.refine(
    (v) =>
      Object.entries(v).some(
        ([name, value]) => !ignore.includes(name) && value !== undefined,
      ),
    "Nothing to change",
  );
}

const Context = z.strictObject({ actor: LiteLLMActorSchema });
export type OperationContext = { actor: LiteLLMActor };

// ---- gate and parsing -----------------------------------------------------

// Gate order is toggle, then edition, then input validation (Security
// architecture item 2), so every operation calls this before parsing input.
async function gate(name: LiteLLMOperationName): Promise<void> {
  const saved = await getOperationToggles();
  const settings = resolveOperationSettings({
    file: loadGatewayConfig(),
    saved: saved?.toggles ?? null,
  });
  if (!settings[name].enabled) {
    throw new LiteLLMOperationRefused("OPERATION_DISABLED");
  }
  const op = LITELLM_OPERATIONS[name];
  if (
    op.routes.every((r) => r.enterpriseOnly) &&
    liteLLMEdition(env.APP_ENV) === "oss"
  ) {
    throw new LiteLLMOperationRefused("OPERATION_UNAVAILABLE");
  }
}

function parseResponse<S extends z.ZodType>(
  schema: S,
  body: unknown,
): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new LiteLLMError("contract_drift");
  return result.data as z.output<S>;
}

async function read<S extends z.ZodType>(
  template: string,
  query: Record<string, string | number | boolean | undefined>,
  schema: S,
): Promise<z.output<S>> {
  const res = await callAllowlisted({ method: "GET", template, query });
  return parseResponse(schema, res.body);
}

async function write<S extends z.ZodType>(
  template: string,
  actor: LiteLLMActor,
  schema: S,
  extra: { body?: unknown; params?: Record<string, string> } = {},
): Promise<z.output<S>> {
  const res = await callAllowlisted({
    method: "POST",
    template,
    actor,
    ...extra,
  });
  return parseResponse(schema, res.body);
}

// ---- response schemas -----------------------------------------------------

const Loose = z.looseObject({});
const Ack = Loose.nullable();
const KeyRow = z.object({
  token: z.string(),
  team_id: z.string().nullish(),
  user_id: z.string().nullish(),
  key_alias: z.string().nullish(),
  blocked: z.boolean().nullish(),
  expires: z.string().nullish(),
  models: z.array(z.string()).nullish(),
  spend: z.number().nullish(),
  max_budget: z.number().nullish(),
  budget_duration: z.string().nullish(),
  rpm_limit: z.number().nullish(),
  tpm_limit: z.number().nullish(),
  max_parallel_requests: z.number().nullish(),
});
const Paging = {
  total: z.number().nullish(),
  page: z.number().nullish(),
  page_size: z.number().nullish(),
  total_pages: z.number().nullish(),
};
const TeamInfoResponse = z.object({
  team_id: z.string(),
  team_info: z.object({
    team_id: z.string().nullish(),
    team_alias: z.string().nullish(),
    max_budget: z.number().nullish(),
    soft_budget: z.number().nullish(),
    budget_duration: z.string().nullish(),
    spend: z.number().nullish(),
    models: z.array(z.string()).nullish(),
    rpm_limit: z.number().nullish(),
    tpm_limit: z.number().nullish(),
    members_with_roles: z
      .array(
        z.object({
          user_id: z.string().nullish(),
          user_email: z.string().nullish(),
          role: z.string().nullish(),
        }),
      )
      .nullish(),
  }),
  keys: z.array(KeyRow).default([]),
  team_memberships: z.array(Loose).default([]),
});
const TeamListResponse = z.array(
  z.object({ team_id: z.string(), team_alias: z.string().nullish() }),
);
const DailyActivityResponse = z.object({
  results: z.array(Loose),
  metadata: Loose.default({}),
});
const UserInfoResponse = z.object({
  user_id: z.string().nullish(),
  user_info: z
    .object({
      user_id: z.string().nullish(),
      user_email: z.string().nullish(),
      user_role: z.string().nullish(),
      spend: z.number().nullish(),
      max_budget: z.number().nullish(),
    })
    .nullish(),
  keys: z.array(KeyRow).default([]),
  teams: z.array(Loose).default([]),
});
const UserListResponse = z.object({
  users: z.array(
    z.object({
      user_id: z.string(),
      user_email: z.string().nullish(),
      user_role: z.string().nullish(),
    }),
  ),
  ...Paging,
});
const UserSearchResponse = z.object({
  users: z.array(
    z.object({
      user_id: z.string(),
      user_email: z.string().nullish(),
      spend: z.number().nullish(),
      max_budget: z.number().nullish(),
      teams: z.array(z.string()).nullish(),
    }),
  ),
  ...Paging,
});
const KeyListResponse = z.object({
  keys: z.array(KeyRow),
  total_count: z.number().nullish(),
  current_page: z.number().nullish(),
  total_pages: z.number().nullish(),
});
const KeyInfoResponse = z.object({
  key: z.string().nullish(),
  info: KeyRow,
});
const SpendLogsResponse = z.object({ data: z.array(Loose), ...Paging });
const ModelsResponse = z.object({
  data: z.array(z.object({ id: z.string() })),
});
const GlobalSpendResponse = z.array(Loose);
const changedFieldNames = (value: unknown): string[] => {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? Object.keys(parsed)
    : [];
};
// Only these fields leave parsing; contents of before_value / updated_values
// and changed_by_api_key are dropped here (Audit item 3).
const AuditRow = z
  .object({
    id: z.string(),
    updated_at: z.string(),
    changed_by: z.string().nullish(),
    action: z.string(),
    table_name: z.string(),
    object_id: z.string().nullish(),
    before_value: z.unknown().optional(),
    updated_values: z.unknown().optional(),
  })
  .transform((r) => ({
    id: r.id,
    updatedAt: r.updated_at,
    changedBy: r.changed_by ?? null,
    action: r.action,
    tableName: r.table_name,
    objectId: r.object_id ?? null,
    changedFields: [
      ...new Set([
        ...changedFieldNames(r.before_value),
        ...changedFieldNames(r.updated_values),
      ]),
    ].sort(),
  }));
const AuditResponse = z.object({
  audit_logs: z.array(AuditRow),
  ...Paging,
});
const TeamIdResponse = z.object({ team_id: z.string() });
const UserNewResponse = z.object({
  user_id: z.string(),
  user_email: z.string().nullish(),
});
const MemberUpdateResponse = z.object({
  user_id: z.string().nullish(),
  team_id: z.string().nullish(),
});
const ResetBudgetResponse = z.object({
  budget_id: z.string().nullish(),
  previous_budget_id: z.string().nullish(),
});
const KeyIssuedResponse = z
  .object({
    key: z.string().min(1),
    token: z.string().nullish(),
    token_id: z.string().nullish(),
  })
  .transform((r, ctx) => {
    const tokenId = r.token_id ?? r.token;
    if (!tokenId) {
      ctx.addIssue({ code: "custom", message: "missing token id" });
      return z.NEVER;
    }
    return { key: r.key, tokenId };
  });

// ---- reads ----------------------------------------------------------------

export async function getTeam(input: { litellmTeamId: string }) {
  await gate("getTeam");
  const i = z.strictObject({ litellmTeamId: LiteLLMId }).parse(input);
  return read("/team/info", { team_id: i.litellmTeamId }, TeamInfoResponse);
}

// Linking confirms the team exists with a read that bypasses the `getTeam`
// read toggle, as the connection-test probes do: a link is a dashboard-only
// configuration write, not a use of the read (Writes table, `linkTeam`).
export async function confirmTeamExists(input: { litellmTeamId: string }) {
  const i = z.strictObject({ litellmTeamId: LiteLLMId }).parse(input);
  await read("/team/info", { team_id: i.litellmTeamId }, TeamInfoResponse);
}

export async function listProxyTeams() {
  await gate("listProxyTeams");
  return read("/team/list", {}, TeamListResponse);
}

const TeamDailyInput = withRange(
  z
    .strictObject({
      litellmTeamId: LiteLLMId.optional(),
      litellmTeamIds: z
        .array(LiteLLMId)
        .min(1)
        .max(200, "At most 200 teams per request")
        .optional(),
      startDate: UtcDaySchema,
      endDate: UtcDaySchema,
    })
    .refine(
      (v) =>
        (v.litellmTeamId === undefined) !== (v.litellmTeamIds === undefined),
      "Exactly one of a team or a list of teams",
    ),
);
const UserDailyInput = withRange(
  z.strictObject({
    litellmUserId: LiteLLMId,
    startDate: UtcDaySchema,
    endDate: UtcDaySchema,
  }),
);

// `timezone` is an integer offset in minutes in the contract (1.109.1); 0 is
// UTC (the spec's `timezone=UTC`).
const UTC_OFFSET = 0;

export async function getTeamDailySpend(input: z.input<typeof TeamDailyInput>) {
  await gate("getTeamDailySpend");
  const i = TeamDailyInput.parse(input);
  return read(
    "/team/daily/activity/aggregated",
    {
      team_ids: i.litellmTeamIds?.join(",") ?? i.litellmTeamId,
      start_date: i.startDate,
      end_date: i.endDate,
      timezone: UTC_OFFSET,
    },
    DailyActivityResponse,
  );
}

export async function getUser(input: { litellmUserId: string }) {
  await gate("getUser");
  const i = z.strictObject({ litellmUserId: LiteLLMId }).parse(input);
  return read("/user/info", { user_id: i.litellmUserId }, UserInfoResponse);
}

export async function findUserByEmail(input: { email: string }) {
  await gate("findUserByEmail");
  const i = z.strictObject({ email: Email }).parse(input);
  return findUser(i.email);
}

const SearchUsersInput = z.strictObject({
  search: z.string().trim().min(2).max(100),
  page: PageNumber.optional(),
  pageSize: z.number().int().min(1).max(25).optional(),
  litellmTeamId: LiteLLMId.optional(),
});

export async function searchUsers(input: z.input<typeof SearchUsersInput>) {
  await gate("searchUsers");
  const i = SearchUsersInput.parse(input);
  return read(
    "/user/list",
    {
      search: i.search,
      page: i.page,
      page_size: i.pageSize,
      team: i.litellmTeamId,
    },
    UserSearchResponse,
  );
}

async function findUser(email: string) {
  return read("/user/list", { user_email: email }, UserListResponse);
}

export async function getUserDailySpend(input: z.input<typeof UserDailyInput>) {
  await gate("getUserDailySpend");
  const i = UserDailyInput.parse(input);
  return read(
    "/user/daily/activity",
    {
      user_id: i.litellmUserId,
      start_date: i.startDate,
      end_date: i.endDate,
      timezone: UTC_OFFSET,
    },
    DailyActivityResponse,
  );
}

const ListKeysInput = z
  .strictObject({
    litellmTeamId: LiteLLMId.optional(),
    litellmUserId: LiteLLMId.optional(),
    page: PageNumber.optional(),
    size: PageSize.optional(),
  })
  .refine(
    (v) => v.litellmTeamId !== undefined || v.litellmUserId !== undefined,
    "A team or a user is required",
  );

export async function listKeys(input: z.input<typeof ListKeysInput>) {
  await gate("listKeys");
  const i = ListKeysInput.parse(input);
  return read(
    "/key/list",
    {
      team_id: i.litellmTeamId,
      user_id: i.litellmUserId,
      return_full_object: true,
      page: i.page,
      size: i.size,
    },
    KeyListResponse,
  );
}

export async function getKey(input: { tokenId: string }) {
  await gate("getKey");
  const i = z.strictObject({ tokenId: TokenId }).parse(input);
  return readKey(i.tokenId);
}

async function readKey(tokenId: string) {
  return read("/key/info", { key: tokenId }, KeyInfoResponse);
}

const ListSpendLogsInput = withRange(
  z
    .strictObject({
      litellmTeamId: LiteLLMId.optional(),
      litellmUserId: LiteLLMId.optional(),
      startDate: UtcDaySchema,
      endDate: UtcDaySchema,
      page: PageNumber.optional(),
      pageSize: PageSize.optional(),
    })
    .refine(
      (v) => v.litellmTeamId !== undefined || v.litellmUserId !== undefined,
      "A team or a user is required",
    ),
  MAX_RANGE_DAYS,
);

export async function listSpendLogs(input: z.input<typeof ListSpendLogsInput>) {
  await gate("listSpendLogs");
  const i = ListSpendLogsInput.parse(input);
  return read(
    "/spend/logs/v2",
    {
      team_id: i.litellmTeamId,
      user_id: i.litellmUserId,
      start_date: i.startDate,
      end_date: i.endDate,
      page: i.page,
      page_size: i.pageSize,
    },
    SpendLogsResponse,
  );
}

export async function listProxyModels() {
  await gate("listProxyModels");
  return read("/models", { return_wildcard_routes: false }, ModelsResponse);
}

const AUDIT_TABLES = [
  "LiteLLM_TeamTable",
  "LiteLLM_VerificationToken",
  "LiteLLM_UserTable",
] as const;
const ListAuditInput = withRange(
  z.strictObject({
    startDate: UtcDaySchema,
    endDate: UtcDaySchema,
    page: PageNumber.optional(),
    pageSize: PageSize.optional(),
    action: z
      .string()
      .regex(/^[a-z_]{1,32}$/)
      .optional(),
    tableName: z.enum(AUDIT_TABLES).optional(),
    objectId: LiteLLMId.optional(),
  }),
  MAX_RANGE_DAYS,
);

export async function listProxyAuditLog(input: z.input<typeof ListAuditInput>) {
  await gate("listProxyAuditLog");
  const i = ListAuditInput.parse(input);
  return read(
    "/audit",
    {
      start_date: i.startDate,
      end_date: i.endDate,
      page: i.page,
      page_size: i.pageSize,
      action: i.action,
      table_name: i.tableName,
      object_id: i.objectId,
    },
    AuditResponse,
  );
}

const GlobalSpendInput = withRange(
  z.strictObject({ startDate: UtcDaySchema, endDate: UtcDaySchema }),
);

export async function getGlobalSpendReport(
  input: z.input<typeof GlobalSpendInput>,
) {
  await gate("getGlobalSpendReport");
  const i = GlobalSpendInput.parse(input);
  return read(
    "/global/spend/report",
    { start_date: i.startDate, end_date: i.endDate, group_by: "team" },
    GlobalSpendResponse,
  );
}

// ---- writes ---------------------------------------------------------------

const metadata = (
  dashboardTeamId: string,
  extra: Record<string, string> = {},
) => ({
  source: "llm-usage-lens",
  dashboardTeamId,
  ...extra,
});

const CreateTeamInput = z.strictObject({
  teamAlias: KeyAlias,
  dashboardTeamId: DashboardTeamId,
  maxBudget: Budget.optional(),
  budgetDuration: Duration.optional(),
  rpmLimit: Limit.optional(),
  tpmLimit: Limit.optional(),
  models: Models.optional(),
});

export async function createTeam(
  input: z.input<typeof CreateTeamInput>,
  ctx: OperationContext,
) {
  await gate("createTeam");
  const i = CreateTeamInput.parse(input);
  const { actor } = Context.parse(ctx);
  const r = await write("/team/new", actor, TeamIdResponse, {
    body: {
      team_alias: i.teamAlias,
      max_budget: i.maxBudget,
      budget_duration: i.budgetDuration,
      rpm_limit: i.rpmLimit,
      tpm_limit: i.tpmLimit,
      models: i.models,
      metadata: metadata(i.dashboardTeamId),
    },
  });
  return { litellmTeamId: r.team_id };
}

const SetTeamBudgetInput = atLeastOne(
  z.strictObject({
    litellmTeamId: LiteLLMId,
    maxBudget: Budget.optional(),
    budgetDuration: Duration.optional(),
    softBudget: Budget.optional(),
  }),
  ["litellmTeamId"],
);

export async function setTeamBudget(
  input: z.input<typeof SetTeamBudgetInput>,
  ctx: OperationContext,
) {
  await gate("setTeamBudget");
  const i = SetTeamBudgetInput.parse(input);
  const { actor } = Context.parse(ctx);
  await write("/team/update", actor, TeamIdResponse, {
    body: {
      team_id: i.litellmTeamId,
      max_budget: i.maxBudget,
      budget_duration: i.budgetDuration,
      soft_budget: i.softBudget,
    },
  });
}

const SetTeamLimitsInput = atLeastOne(
  z.strictObject({
    litellmTeamId: LiteLLMId,
    rpmLimit: Limit.optional(),
    tpmLimit: Limit.optional(),
    modelRpmLimit: ModelLimits.optional(),
    modelTpmLimit: ModelLimits.optional(),
    teamMemberRpmLimit: Limit.optional(),
    teamMemberTpmLimit: Limit.optional(),
  }),
  ["litellmTeamId"],
);

export async function setTeamLimits(
  input: z.input<typeof SetTeamLimitsInput>,
  ctx: OperationContext,
) {
  await gate("setTeamLimits");
  const i = SetTeamLimitsInput.parse(input);
  const { actor } = Context.parse(ctx);
  await write("/team/update", actor, TeamIdResponse, {
    body: {
      team_id: i.litellmTeamId,
      rpm_limit: i.rpmLimit,
      tpm_limit: i.tpmLimit,
      model_rpm_limit: i.modelRpmLimit,
      model_tpm_limit: i.modelTpmLimit,
      team_member_rpm_limit: i.teamMemberRpmLimit,
      team_member_tpm_limit: i.teamMemberTpmLimit,
    },
  });
}

const SetTeamModelsInput = z.strictObject({
  litellmTeamId: LiteLLMId,
  models: Models,
});

export async function setTeamModels(
  input: z.input<typeof SetTeamModelsInput>,
  ctx: OperationContext,
) {
  await gate("setTeamModels");
  const i = SetTeamModelsInput.parse(input);
  const { actor } = Context.parse(ctx);
  await write("/team/update", actor, TeamIdResponse, {
    body: { team_id: i.litellmTeamId, models: i.models },
  });
}

// Enterprise users are created by LiteLLM at SSO sign-in; the dashboard never
// creates one there (Identity mapping). Callers map this to 409 CONFLICT.
export class LiteLLMUserNotSignedIn extends Error {
  constructor() {
    super("The person has not signed in to LiteLLM yet");
    this.name = "LiteLLMUserNotSignedIn";
  }
}

const AddTeamMemberInput = z.strictObject({
  litellmTeamId: LiteLLMId,
  email: Email,
  maxBudgetInTeam: Budget.optional(),
  budgetDuration: Duration.optional(),
});

export async function addTeamMember(
  input: z.input<typeof AddTeamMemberInput>,
  ctx: OperationContext,
) {
  await gate("addTeamMember");
  const i = AddTeamMemberInput.parse(input);
  const { actor } = Context.parse(ctx);
  const found = (await findUser(i.email)).users.find(
    (u) => u.user_email?.toLowerCase() === i.email,
  );
  let litellmUserId = found?.user_id;
  if (litellmUserId === undefined) {
    if (liteLLMEdition(env.APP_ENV) !== "oss") {
      throw new LiteLLMUserNotSignedIn();
    }
    // The auto-created key (if any) is never read or returned (LT17).
    const created = await write("/user/new", actor, UserNewResponse, {
      body: {
        user_id: i.email,
        user_email: i.email,
        user_role: "internal_user",
        auto_create_key: false,
        send_invite_email: false,
      },
    });
    litellmUserId = created.user_id;
  }
  await write("/team/member_add", actor, Ack, {
    body: {
      team_id: i.litellmTeamId,
      member: { user_id: litellmUserId, role: "user" },
      max_budget_in_team: i.maxBudgetInTeam,
      budget_duration: i.budgetDuration,
    },
  });
  return { litellmUserId };
}

const MemberInput = z.strictObject({
  litellmTeamId: LiteLLMId,
  litellmUserId: LiteLLMId,
});

export async function removeTeamMember(
  input: z.input<typeof MemberInput>,
  ctx: OperationContext,
) {
  await gate("removeTeamMember");
  const i = MemberInput.parse(input);
  const { actor } = Context.parse(ctx);
  await write("/team/member_delete", actor, Ack, {
    body: { team_id: i.litellmTeamId, user_id: i.litellmUserId },
  });
}

const SetMemberBudgetInput = atLeastOne(
  z.strictObject({
    litellmTeamId: LiteLLMId,
    litellmUserId: LiteLLMId,
    maxBudgetInTeam: Budget.optional(),
    budgetDuration: Duration.optional(),
  }),
  ["litellmTeamId", "litellmUserId"],
);

export async function setMemberBudget(
  input: z.input<typeof SetMemberBudgetInput>,
  ctx: OperationContext,
) {
  await gate("setMemberBudget");
  const i = SetMemberBudgetInput.parse(input);
  const { actor } = Context.parse(ctx);
  await write("/team/member_update", actor, MemberUpdateResponse, {
    body: {
      team_id: i.litellmTeamId,
      user_id: i.litellmUserId,
      max_budget_in_team: i.maxBudgetInTeam,
      budget_duration: i.budgetDuration,
    },
  });
}

const SetMemberLimitsInput = atLeastOne(
  z.strictObject({
    litellmTeamId: LiteLLMId,
    litellmUserId: LiteLLMId,
    rpmLimit: Limit.optional(),
    tpmLimit: Limit.optional(),
  }),
  ["litellmTeamId", "litellmUserId"],
);

export async function setMemberLimits(
  input: z.input<typeof SetMemberLimitsInput>,
  ctx: OperationContext,
) {
  await gate("setMemberLimits");
  const i = SetMemberLimitsInput.parse(input);
  const { actor } = Context.parse(ctx);
  await write("/team/member_update", actor, MemberUpdateResponse, {
    body: {
      team_id: i.litellmTeamId,
      user_id: i.litellmUserId,
      rpm_limit: i.rpmLimit,
      tpm_limit: i.tpmLimit,
    },
  });
}

export async function resetMemberSpend(
  input: z.input<typeof MemberInput>,
  ctx: OperationContext,
) {
  await gate("resetMemberSpend");
  const i = MemberInput.parse(input);
  const { actor } = Context.parse(ctx);
  await write("/team/{team_id}/member/{user_id}/reset_spend", actor, Ack, {
    params: { team_id: i.litellmTeamId, user_id: i.litellmUserId },
    body: { reset_to: 0 },
  });
}

export async function resetMemberBudget(
  input: z.input<typeof MemberInput>,
  ctx: OperationContext,
) {
  await gate("resetMemberBudget");
  const i = MemberInput.parse(input);
  const { actor } = Context.parse(ctx);
  const r = await write(
    "/team/{team_id}/member/{user_id}/reset_budget",
    actor,
    ResetBudgetResponse,
    {
      params: { team_id: i.litellmTeamId, user_id: i.litellmUserId },
      body: {},
    },
  );
  return {
    budgetId: r.budget_id ?? null,
    previousBudgetId: r.previous_budget_id ?? null,
  };
}

// Every key the member owns in that team, and only those: LiteLLM's filter is
// re-checked here (LT7).
async function memberKeyTokens(
  litellmTeamId: string,
  litellmUserId: string,
): Promise<string[]> {
  const MAX_PAGES = 100;
  const tokens: string[] = [];
  for (let page = 1; ; page += 1) {
    const list = await read(
      "/key/list",
      {
        team_id: litellmTeamId,
        user_id: litellmUserId,
        return_full_object: true,
        page,
        size: 100,
      },
      KeyListResponse,
    );
    for (const row of list.keys) {
      if (row.team_id === litellmTeamId && row.user_id === litellmUserId) {
        const token = TokenId.safeParse(row.token);
        if (!token.success) throw new LiteLLMError("contract_drift");
        tokens.push(token.data);
      }
    }
    if (page >= (list.total_pages ?? 1)) return tokens;
    // Stopping at the cap would leave some of the member's keys untouched.
    if (page >= MAX_PAGES) throw new LiteLLMError("contract_drift");
  }
}

async function setMemberKeysBlocked(
  name: "disableMember" | "enableMember",
  input: z.input<typeof MemberInput>,
  ctx: OperationContext,
) {
  await gate(name);
  const i = MemberInput.parse(input);
  const { actor } = Context.parse(ctx);
  const template = name === "disableMember" ? "/key/block" : "/key/unblock";
  const tokens = await memberKeyTokens(i.litellmTeamId, i.litellmUserId);
  for (const key of tokens) {
    await write(template, actor, Ack, { body: { key } });
  }
  return { tokenIds: tokens };
}

export function disableMember(
  input: z.input<typeof MemberInput>,
  ctx: OperationContext,
) {
  return setMemberKeysBlocked("disableMember", input, ctx);
}

export function enableMember(
  input: z.input<typeof MemberInput>,
  ctx: OperationContext,
) {
  return setMemberKeysBlocked("enableMember", input, ctx);
}

const KeySettings = {
  models: Models.optional(),
  maxBudget: Budget.optional(),
  budgetDuration: Duration.optional(),
  rpmLimit: Limit.optional(),
  tpmLimit: Limit.optional(),
  maxParallelRequests: Limit.optional(),
  keyAlias: KeyAlias.optional(),
};
const GenerateKeyInput = z.strictObject({
  litellmTeamId: LiteLLMId,
  litellmUserId: LiteLLMId,
  dashboardTeamId: DashboardTeamId,
  duration: Duration.optional(),
  ...KeySettings,
});
type GenerateKey = z.output<typeof GenerateKeyInput>;

// The key value comes back once, to the caller; it is never logged or stored.
async function generateKey(i: GenerateKey, actor: LiteLLMActor) {
  return write("/key/generate", actor, KeyIssuedResponse, {
    body: {
      team_id: i.litellmTeamId,
      user_id: i.litellmUserId,
      models: i.models,
      max_budget: i.maxBudget,
      budget_duration: i.budgetDuration,
      rpm_limit: i.rpmLimit,
      tpm_limit: i.tpmLimit,
      max_parallel_requests: i.maxParallelRequests,
      duration: i.duration,
      key_alias: i.keyAlias,
      metadata: metadata(i.dashboardTeamId, { createdByOid: actor.oid }),
    },
  });
}

export async function generateMemberKey(
  input: z.input<typeof GenerateKeyInput>,
  ctx: OperationContext,
) {
  await gate("generateMemberKey");
  const i = GenerateKeyInput.parse(input);
  const { actor } = Context.parse(ctx);
  return generateKey(i, actor);
}

const UpdateMemberKeyInput = atLeastOne(
  z.strictObject({ tokenId: TokenId, ...KeySettings }),
  ["tokenId"],
);

export async function updateMemberKey(
  input: z.input<typeof UpdateMemberKeyInput>,
  ctx: OperationContext,
) {
  await gate("updateMemberKey");
  const i = UpdateMemberKeyInput.parse(input);
  const { actor } = Context.parse(ctx);
  await write("/key/update", actor, Ack, {
    body: {
      key: i.tokenId,
      models: i.models,
      max_budget: i.maxBudget,
      budget_duration: i.budgetDuration,
      rpm_limit: i.rpmLimit,
      tpm_limit: i.tpmLimit,
      max_parallel_requests: i.maxParallelRequests,
      key_alias: i.keyAlias,
    },
  });
}

const TokenInput = z.strictObject({ tokenId: TokenId });

async function blockToken(tokenId: string, actor: LiteLLMActor) {
  await write("/key/block", actor, Ack, { body: { key: tokenId } });
}

export async function blockKey(
  input: z.input<typeof TokenInput>,
  ctx: OperationContext,
) {
  await gate("blockKey");
  const i = TokenInput.parse(input);
  const { actor } = Context.parse(ctx);
  await blockToken(i.tokenId, actor);
}

export async function unblockKey(
  input: z.input<typeof TokenInput>,
  ctx: OperationContext,
) {
  await gate("unblockKey");
  const i = TokenInput.parse(input);
  const { actor } = Context.parse(ctx);
  await write("/key/unblock", actor, Ack, { body: { key: i.tokenId } });
}

export async function deleteKey(
  input: z.input<typeof TokenInput>,
  ctx: OperationContext,
) {
  await gate("deleteKey");
  const i = TokenInput.parse(input);
  const { actor } = Context.parse(ctx);
  // Exactly one key per call.
  await write("/key/delete", actor, Ack, { body: { keys: [i.tokenId] } });
}

// The old key's remaining lifetime as a whole-day (else hour, else minute)
// duration, rounded DOWN to the unit so the new key never outlives the old one,
// and capped at the schema's four digits. An expiry that has passed, ends
// within the minute or cannot be read is contract drift.
function remainingDuration(expires: string | null | undefined) {
  if (expires == null) return undefined;
  const left = Date.parse(expires) - Date.now();
  if (!Number.isFinite(left) || left < 60_000) {
    throw new LiteLLMError("contract_drift");
  }
  if (left >= DAY_MS) return `${Math.min(Math.floor(left / DAY_MS), 9999)}d`;
  if (left >= 3_600_000) return `${Math.floor(left / 3_600_000)}h`;
  return `${Math.floor(left / 60_000)}m`;
}

// A rotation the current state of the old key or its team does not allow.
// Callers map `code` to the HTTP status; no write has happened.
export class LiteLLMKeyRefused extends Error {
  constructor(readonly code: "CONFLICT" | "NOT_FOUND") {
    super(
      code === "CONFLICT"
        ? "The key's models are no longer available to its team"
        : "The key was not found for this team and person",
    );
    this.name = "LiteLLMKeyRefused";
  }
}

const RotateKeyInput = z.strictObject({
  tokenId: TokenId,
  litellmTeamId: LiteLLMId,
  litellmUserId: LiteLLMId,
  dashboardTeamId: DashboardTeamId,
  gracePeriod: Duration.optional(),
});

export async function rotateKey(
  input: z.input<typeof RotateKeyInput>,
  ctx: OperationContext,
) {
  await gate("rotateKey");
  const i = RotateKeyInput.parse(input);
  const { actor } = Context.parse(ctx);
  if (liteLLMEdition(env.APP_ENV) === "enterprise") {
    // Exactly `{ grace_period }`: never new_key, ids or allowed_routes.
    return write("/key/{key}/regenerate", actor, KeyIssuedResponse, {
      params: { key: i.tokenId },
      body: i.gracePeriod === undefined ? {} : { grace_period: i.gracePeriod },
    });
  }
  // OSS: a new key with the old key's models, limits, expiry and blocked
  // state (never its alias, which LiteLLM requires to be unique), then block
  // the old one. Spec: the `rotateKey` row (OSS carry-over, 2026-11-15).
  const old = (await readKey(i.tokenId)).info;
  if (old.team_id !== i.litellmTeamId || old.user_id !== i.litellmUserId) {
    throw new LiteLLMKeyRefused("NOT_FOUND");
  }
  const models = old.models ?? [];
  if (!Models.safeParse(models).success && models.length > 0) {
    throw new LiteLLMError("contract_drift");
  }
  if (models.length > 0) {
    // LT14: the copied models must still be allowed to the team and listed by
    // the proxy; checked with reads that bypass the read toggles, as a
    // rotation is one write operation.
    const [team, listed] = await Promise.all([
      read("/team/info", { team_id: i.litellmTeamId }, TeamInfoResponse),
      read("/models", { return_wildcard_routes: false }, ModelsResponse),
    ]);
    const teamModels = team.team_info.models ?? [];
    const proxyModels = new Set(listed.data.map((m) => m.id));
    const stale = models.some(
      (m) =>
        !proxyModels.has(m) ||
        (teamModels.length > 0 && !teamModels.includes(m)),
    );
    if (stale) throw new LiteLLMKeyRefused("CONFLICT");
  }
  const duration = remainingDuration(old.expires);
  const issued = await generateKey(
    GenerateKeyInput.parse({
      litellmTeamId: i.litellmTeamId,
      litellmUserId: i.litellmUserId,
      dashboardTeamId: i.dashboardTeamId,
      ...(models.length > 0 ? { models } : {}),
      ...(old.max_budget != null ? { maxBudget: old.max_budget } : {}),
      ...(old.budget_duration != null &&
      Duration.safeParse(old.budget_duration).success
        ? { budgetDuration: old.budget_duration }
        : {}),
      ...(old.rpm_limit != null ? { rpmLimit: old.rpm_limit } : {}),
      ...(old.tpm_limit != null ? { tpmLimit: old.tpm_limit } : {}),
      ...(old.max_parallel_requests != null
        ? { maxParallelRequests: old.max_parallel_requests }
        : {}),
      ...(duration !== undefined ? { duration } : {}),
    }),
    actor,
  );
  // `blocked` is no field of /key/generate (LT4): a blocked old key's state is
  // carried by blocking the new key before the old one.
  if (old.blocked === true) await blockToken(issued.tokenId, actor);
  await blockToken(i.tokenId, actor);
  return issued;
}
