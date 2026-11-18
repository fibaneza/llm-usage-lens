import "server-only";

import {
  LITELLM_OPERATION_NAMES,
  liteLLMEdition,
} from "@llm-usage-lens/shared";
import type { LiteLLMOperationName } from "@llm-usage-lens/shared";
import type { Session } from "next-auth";
import { z } from "zod";

import { env } from "@/env";
import { NOT_FOUND_MESSAGE, NotFoundError } from "@/lib/api/respond";
import { scopeFor } from "@/lib/api/scoped-rollups";
import type { Scope } from "@/lib/auth/policy";
import {
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
} from "@/lib/auth/roles";
import { getAllAccounts } from "@/lib/data/account-meta";
import { getOperationToggles } from "@/lib/data/litellm/toggles";
import { getTeamLink, listTeamLinks } from "@/lib/data/litellm/team-links";

import { LITELLM_OPERATIONS, isValidLiteLLMId } from "./allowlist";
import { LiteLLMError } from "./client";
import { LiteLLMOperationRefused } from "./gateway";
import { loadGatewayConfig } from "./gateway-config";
import { resolveOperationSettings } from "./operation-settings";
import { globalRolesFor, liteLLMErrorResponse } from "./route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "Allowlist -> Reads" (who may
// read; the only query fields), "Roles and rights", "Cost visualisation and
// provenance" (loose upstream rows are reduced to allowlisted fields before
// they leave the server), "API routes" (error codes), Access Control —
// "Enforcement" item 2 (an out-of-scope team answers the missing-team 404).

// ---- LiteLLM failures as responses -----------------------------------------

export async function liteLLMResponse(
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const response = liteLLMErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

// ---- toggles ---------------------------------------------------------------

// The operations that are switched on and available on this edition, resolved
// the way the gateway's own gate does (toggle, then edition).
export async function enabledOperations(): Promise<LiteLLMOperationName[]> {
  const saved = await getOperationToggles();
  const settings = resolveOperationSettings({
    file: loadGatewayConfig(),
    saved: saved?.toggles ?? null,
  });
  const oss = liteLLMEdition(env.APP_ENV) === "oss";
  return LITELLM_OPERATION_NAMES.filter(
    (name) =>
      settings[name].enabled &&
      !(LITELLM_OPERATIONS[name].ossOnly === true && !oss) &&
      !(
        oss &&
        LITELLM_OPERATIONS[name].routes.length > 0 &&
        LITELLM_OPERATIONS[name].routes.every((r) => r.enterpriseOnly)
      ),
  );
}

// A view that needs several reads answers 403 before the first call when any
// of them is off (Toggles narrow only; LD19).
export function requireEnabled(
  enabled: readonly LiteLLMOperationName[],
  needed: readonly LiteLLMOperationName[],
): void {
  if (needed.some((name) => !enabled.includes(name))) {
    throw new LiteLLMOperationRefused("OPERATION_DISABLED");
  }
}

// ---- scope -----------------------------------------------------------------

// Lead in scope, org-wide readers (internal-org-admin, internal-auditor) and
// Admin read a team's LiteLLM views; membership and visibility settings never
// grant them (Roles and rights).
function canReadTeamViews(scope: Scope, teamId: string, departmentId: string) {
  return (
    scope.authenticated &&
    (scope.global ||
      scope.teamScopes.has(teamId) ||
      scope.departmentScopes.has(departmentId))
  );
}

// Organisation cap (Access Control - "Organisation cap"; LiteLLM LD23): in
// prod until the per-user approval is recorded, per-user cost is not shown.
export const hidesPerUserCost = (scope: Scope) => scope.userLevelCap !== "all";

export type LiteLLMTeamRef = {
  teamId: string;
  teamName: string;
  litellmTeamId: string | null;
  perUserCostHidden: boolean;
};

// Out-of-scope and missing teams throw the same NotFoundError.
export async function resolveLiteLLMTeam(
  session: Session,
  teamId: string,
): Promise<LiteLLMTeamRef> {
  const meta = (await getAllAccounts()).find((a) => a.teamId === teamId);
  const scope = await scopeFor(session, [], {});
  if (!meta || !canReadTeamViews(scope, teamId, meta.departmentId)) {
    throw new NotFoundError(NOT_FOUND_MESSAGE);
  }
  const link = await getTeamLink(teamId);
  return {
    teamId,
    teamName: meta.teamName,
    litellmTeamId: link?.litellmTeamId ?? null,
    perUserCostHidden: hidesPerUserCost(scope),
  };
}

export type ViewableTeam = {
  teamId: string;
  teamName: string;
  linked: boolean;
  // May open the team configuration page for this team (LD25): a Lead in
  // scope, org-admin or Admin; never the Auditor.
  configurable: boolean;
};

const CONFIGURING_ROLES: readonly string[] = [
  INTERNAL_ADMIN_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
];

// The teams the caller may open as Lead, Admin or Auditor, with whether each
// is linked to LiteLLM; plus the LiteLLM ids of every linked team.
export async function viewableTeams(session: Session): Promise<{
  teams: ViewableTeam[];
  linkedLiteLLMTeamIds: Set<string>;
}> {
  const [accounts, links, scope, roles] = await Promise.all([
    getAllAccounts(),
    listTeamLinks(),
    scopeFor(session, [], {}),
    globalRolesFor(session),
  ]);
  const linked = new Set(links.map((l) => l.teamId));
  const writesAnyTeam = !!roles?.some((r) => CONFIGURING_ROLES.includes(r));
  const byId = new Map<string, ViewableTeam>();
  for (const a of accounts) {
    if (byId.has(a.teamId)) continue;
    if (!canReadTeamViews(scope, a.teamId, a.departmentId)) continue;
    byId.set(a.teamId, {
      teamId: a.teamId,
      teamName: a.teamName,
      linked: linked.has(a.teamId),
      configurable:
        writesAnyTeam ||
        scope.teamScopes.has(a.teamId) ||
        scope.departmentScopes.has(a.departmentId),
    });
  }
  return {
    teams: [...byId.values()].sort((a, b) =>
      a.teamName.localeCompare(b.teamName),
    ),
    linkedLiteLLMTeamIds: new Set(links.map((l) => l.litellmTeamId)),
  };
}

export type LinkedTeam = {
  teamId: string;
  teamName: string;
  litellmTeamId: string;
};

export type TeamAccess = {
  // org-admin, Admin or Auditor: the whole proxy (Views by role - Scope).
  orgWide: boolean;
  // Lead of at least one team (linked or not); never a Viewer.
  lead: boolean;
  // Linked teams the caller may read, by dashboard team.
  linked: LinkedTeam[];
  // Organisation cap in force: per-user LiteLLM cost stays hidden (LD23).
  perUserCostHidden: boolean;
};

const ORG_WIDE_ROLES: readonly string[] = [
  INTERNAL_ADMIN_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
];

// org-admin, Admin or Auditor: the roles that may ask for the second figure
// (App Teams spec - Spend source, ATT6). Stored grants count.
export async function isOrgWideReader(session: Session): Promise<boolean> {
  const roles = await globalRolesFor(session);
  return !!roles?.some((r) => ORG_WIDE_ROLES.includes(r));
}

// Roles come from globalRolesFor (stored grants count); the team list from
// the same scope the other L3 views use. Read per request, never cached.
export async function teamAccess(session: Session): Promise<TeamAccess> {
  const [roles, accounts, links, scope] = await Promise.all([
    globalRolesFor(session),
    getAllAccounts(),
    listTeamLinks(),
    scopeFor(session, [], {}),
  ]);
  const orgWide = !!roles?.some((r) => ORG_WIDE_ROLES.includes(r));
  const linkOf = new Map(links.map((l) => [l.teamId, l.litellmTeamId]));
  const seen = new Set<string>();
  const linked: LinkedTeam[] = [];
  let readable = 0;
  for (const a of accounts) {
    if (seen.has(a.teamId)) continue;
    seen.add(a.teamId);
    if (!canReadTeamViews(scope, a.teamId, a.departmentId)) continue;
    readable += 1;
    const litellmTeamId = linkOf.get(a.teamId);
    if (litellmTeamId) {
      linked.push({
        teamId: a.teamId,
        teamName: a.teamName,
        litellmTeamId,
      });
    }
  }
  linked.sort((x, y) => x.teamName.localeCompare(y.teamName));
  return {
    orgWide,
    lead: !orgWide && readable > 0,
    linked,
    perUserCostHidden: hidesPerUserCost(scope),
  };
}

// ---- query parsing ---------------------------------------------------------

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const AUDIT_TABLES = [
  "LiteLLM_TeamTable",
  "LiteLLM_VerificationToken",
  "LiteLLM_UserTable",
] as const;

export const UserSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(25).optional(),
});

export const LiteLLMUserIdSchema = z
  .string()
  .refine(isValidLiteLLMId, "Invalid id");

export const AuditQuerySchema = PageQuerySchema.extend({
  action: z
    .string()
    .regex(/^[a-z_]{1,32}$/)
    .optional(),
  tableName: z.enum(AUDIT_TABLES).optional(),
  objectId: z.string().refine(isValidLiteLLMId, "Invalid id").optional(),
});

// ---- reduction of loose upstream rows --------------------------------------

const Num = z.number().nullish();
const Text = z.string().nullish();

function reduceRows<S extends z.ZodType>(
  schema: S,
  rows: readonly unknown[],
): z.output<S>[] {
  return rows.map((row) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) throw new LiteLLMError("contract_drift");
    return parsed.data as z.output<S>;
  });
}

const DailyRow = z
  .object({
    date: z.string(),
    metrics: z
      .object({
        spend: Num,
        prompt_tokens: Num,
        completion_tokens: Num,
        total_tokens: Num,
        api_requests: Num,
        successful_requests: Num,
        failed_requests: Num,
      })
      .default({}),
  })
  .transform((r) => ({
    date: r.date,
    spend: r.metrics.spend ?? 0,
    promptTokens: r.metrics.prompt_tokens ?? 0,
    completionTokens: r.metrics.completion_tokens ?? 0,
    totalTokens: r.metrics.total_tokens ?? 0,
    apiRequests: r.metrics.api_requests ?? 0,
    successfulRequests: r.metrics.successful_requests ?? 0,
    failedRequests: r.metrics.failed_requests ?? 0,
  }));

export const reduceDaily = (rows: readonly unknown[]) =>
  reduceRows(DailyRow, rows);

const SpendLogRow = z
  .object({
    request_id: z.string(),
    startTime: Text,
    model: Text,
    spend: Num,
    prompt_tokens: Num,
    completion_tokens: Num,
    total_tokens: Num,
    user: Text,
    status: Text,
  })
  .transform((r) => ({
    requestId: r.request_id,
    startTime: r.startTime ?? null,
    model: r.model ?? null,
    spend: r.spend ?? 0,
    promptTokens: r.prompt_tokens ?? null,
    completionTokens: r.completion_tokens ?? null,
    totalTokens: r.total_tokens ?? null,
    user: r.user ?? null,
    status: r.status ?? null,
  }));

export const reduceSpendLogs = (rows: readonly unknown[]) =>
  reduceRows(SpendLogRow, rows);

const MembershipRow = z.object({
  user_id: z.string(),
  spend: Num,
  litellm_budget_table: z
    .object({
      max_budget: Num,
      budget_duration: Text,
      rpm_limit: Num,
      tpm_limit: Num,
      max_parallel_requests: Num,
    })
    .nullish(),
});

export type MemberRow = {
  userId: string;
  email: string;
  spend: number;
  maxBudget: number | null;
  budgetDuration: string | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  maxParallelRequests: number | null;
};

export function reduceMembers(
  memberships: readonly unknown[],
  emails: ReadonlyMap<string, string>,
): MemberRow[] {
  return reduceRows(MembershipRow, memberships).map((m) => ({
    userId: m.user_id,
    email: emails.get(m.user_id) ?? m.user_id,
    spend: m.spend ?? 0,
    maxBudget: m.litellm_budget_table?.max_budget ?? null,
    budgetDuration: m.litellm_budget_table?.budget_duration ?? null,
    rpmLimit: m.litellm_budget_table?.rpm_limit ?? null,
    tpmLimit: m.litellm_budget_table?.tpm_limit ?? null,
    maxParallelRequests: m.litellm_budget_table?.max_parallel_requests ?? null,
  }));
}

type KeyInput = {
  token: string;
  team_id?: string | null | undefined;
  user_id?: string | null | undefined;
  key_alias?: string | null | undefined;
  blocked?: boolean | null | undefined;
  expires?: string | null | undefined;
  models?: string[] | null | undefined;
  spend?: number | null | undefined;
  max_budget?: number | null | undefined;
  budget_duration?: string | null | undefined;
  rpm_limit?: number | null | undefined;
  tpm_limit?: number | null | undefined;
  max_parallel_requests?: number | null | undefined;
};

// The token HASH only; the key value is never part of the view (LT1, LT9).
export function keyView(k: KeyInput) {
  return {
    tokenId: k.token,
    userId: k.user_id ?? null,
    keyAlias: k.key_alias ?? null,
    blocked: k.blocked ?? false,
    expires: k.expires ?? null,
    models: k.models ?? [],
    spend: k.spend ?? 0,
    maxBudget: k.max_budget ?? null,
    budgetDuration: k.budget_duration ?? null,
    rpmLimit: k.rpm_limit ?? null,
    tpmLimit: k.tpm_limit ?? null,
    maxParallelRequests: k.max_parallel_requests ?? null,
  };
}
