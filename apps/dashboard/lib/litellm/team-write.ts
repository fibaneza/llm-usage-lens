import "server-only";

import type {
  AuditAction,
  AuditSnapshot,
  LiteLLMOperationName,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import { IdParamSchema } from "@/lib/api/id-param";
import { matrixWrite } from "@/lib/api/matrix-route";
import type { MatrixArgs } from "@/lib/api/matrix-route";
import {
  NOT_FOUND_MESSAGE,
  NotFoundError,
  jsonData,
  jsonError,
  parseInput,
  parseJsonBody,
} from "@/lib/api/respond";
import { INTERNAL_ADMIN_ROLE } from "@/lib/auth/roles";
import { buildTeamDirectory } from "@/lib/api/team-directory";
import { getAllAccounts } from "@/lib/data/account-meta";
import { listAppTeams } from "@/lib/data/access/app-teams";
import { getTeamLink } from "@/lib/data/litellm/team-links";

import { TOKEN_HASH_RE } from "./allowlist";
import { LiteLLMError } from "./client";
import { LiteLLMOperationRefused } from "./gateway";
import type { LiteLLMActor } from "./gateway";
import {
  NON_PRIVILEGED_ROLES,
  PrivilegedTargetError,
  audit,
  emailsOf,
  badRequest,
  refusePrivileged,
} from "./member-write";
import type { TeamInfo } from "./member-write";
import {
  Budget,
  Duration,
  KeyAlias,
  LiteLLMKeyRefused,
  Limit,
  Models,
  getKey,
  getTeam,
  getUser,
  listProxyModels,
} from "./operations";
import { enabledOperations, reduceMembers, requireEnabled } from "./read-views";
import type { MemberRow } from "./read-views";
import { liteLLMErrorResponse, openModeRefusal } from "./route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (key and team rows),
// "Resolution" (a token is accepted only after /key/info confirms its team_id),
// "Budgets and limits", "Audit", LD10, LD14, LT5, LT9, LT13, LT14, LT18. The
// shared frame of the key and team-setting routes: session and scope (matrix
// `member` write), path/body parse, team link (409), operation toggle (403),
// the LiteLLM call, one audit record. The frame of the member routes is
// member-write.ts.

export type TeamWriteContext<B> = {
  actor: LiteLLMActor;
  // The caller lacks internal-admin (a Lead or org-admin): only internal-admin
  // sets or raises team values, everyone else only lowers them (LT13, LD26).
  lead: boolean;
  teamId: string;
  litellmTeamId: string;
  tokenId: string;
  body: B;
  // The team's LiteLLM record, read once on first use.
  teamInfo: () => Promise<TeamInfo>;
};

export type TeamWriteResult = {
  data: Record<string, unknown>;
  target: { type: "litellm-key" | "litellm-team"; id: string };
  before?: AuditSnapshot;
  after?: AuditSnapshot;
};

export type TeamWriteConfig<B> = {
  action: AuditAction;
  pattern: string;
  toggle: LiteLLMOperationName;
  status: 200 | 201;
  // The route names a key by its token hash in [tokenId].
  token?: boolean;
  body?: z.ZodType<B>;
};

const TokenIdParam = z.string().regex(TOKEN_HASH_RE);

const notFound = () => jsonError(404, "NOT_FOUND", NOT_FOUND_MESSAGE);

async function runTeamWrite<B>(
  config: TeamWriteConfig<B>,
  { request, params, session, actor, refuse }: MatrixArgs,
  execute: (ctx: TeamWriteContext<B>) => Promise<TeamWriteResult>,
): Promise<Response> {
  const refused = openModeRefusal();
  if (refused) return refused;

  const teamId = parseInput(params.teamId, IdParamSchema);
  const meta = buildTeamDirectory(
    ...(await Promise.all([getAllAccounts(), listAppTeams()])),
  ).find((a) => a.teamId === teamId);
  const scopeRefusal = await refuse({
    operation: "member",
    team: meta ? { teamId, departmentId: meta.departmentId } : null,
  });
  if (scopeRefusal) return scopeRefusal;
  if (!meta) return notFound();

  const tokenId = config.token ? parseInput(params.tokenId, TokenIdParam) : "";
  const body = config.body
    ? await parseJsonBody(request, config.body)
    : (undefined as B);

  const link = await getTeamLink(teamId);
  if (!link) {
    return jsonError(409, "CONFLICT", "The team is not connected to LiteLLM");
  }
  const { litellmTeamId } = link;

  try {
    requireEnabled(await enabledOperations(), [config.toggle]);
  } catch (error) {
    const response = liteLLMErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const liteActor: LiteLLMActor = {
    oid: session.user.oid,
    email: session.user.email ?? null,
  };
  let info: Promise<TeamInfo> | undefined;
  try {
    const result = await execute({
      actor: liteActor,
      lead: !actor.roles.includes(INTERNAL_ADMIN_ROLE),
      teamId,
      litellmTeamId,
      tokenId,
      body,
      teamInfo: () => (info ??= getTeam({ litellmTeamId })),
    });
    await audit(session, config, {
      result: "success",
      teamId,
      target: result.target,
      before: result.before,
      after: result.after,
    });
    return jsonData(result.data, { status: config.status });
  } catch (error) {
    if (error instanceof PrivilegedTargetError) {
      return refusePrivileged(request, session, config, teamId, error);
    }
    if (error instanceof LiteLLMKeyRefused) {
      return error.code === "CONFLICT"
        ? jsonError(409, "CONFLICT", error.message)
        : notFound();
    }
    const response = liteLLMErrorResponse(error);
    if (response) {
      if (!(error instanceof LiteLLMOperationRefused)) {
        await audit(session, config, {
          result: "failed",
          teamId,
          target: tokenId
            ? { type: "litellm-key", id: tokenId }
            : { type: "litellm-team", id: litellmTeamId },
        });
      }
      return response;
    }
    throw error;
  }
}

export function teamWriteRoute<B = undefined>(
  config: TeamWriteConfig<B>,
  execute: (ctx: TeamWriteContext<B>) => Promise<TeamWriteResult>,
) {
  return matrixWrite(
    { operation: "member", action: config.action, pattern: config.pattern },
    (args) => runTeamWrite(config, args, execute),
  );
}

// Only the given fields: unset means omitted, never 0 or null (LT10).
export function defined<T extends Record<string, unknown>>(values: T) {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined),
  ) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

export function atLeastOneField(value: Record<string, unknown>): boolean {
  return Object.values(value).some((v) => v !== undefined);
}

export const NOTHING_TO_CHANGE = { message: "Nothing to change" };

// ---- shared input pieces ---------------------------------------------------

export const PositiveLimit = Limit.min(1);
export const PositiveBudget = Budget.positive();

export const KeySettingsShape = {
  keyAlias: KeyAlias.optional(),
  models: Models.optional(),
  maxBudget: PositiveBudget.optional(),
  budgetDuration: Duration.optional(),
  rpmLimit: PositiveLimit.optional(),
  tpmLimit: PositiveLimit.optional(),
  maxParallelRequests: PositiveLimit.optional(),
};

// ---- team and model checks -------------------------------------------------

export function aboveCeiling(
  value: number | undefined,
  ceiling: number | null | undefined,
): boolean {
  return (
    value !== undefined &&
    ceiling !== null &&
    ceiling !== undefined &&
    value > ceiling
  );
}

// The models a team may use: its own list, else everything the proxy lists
// (an empty team list means every model to LiteLLM).
export async function allowedModels(
  info: TeamInfo,
): Promise<ReadonlySet<string>> {
  const own = info.team_info.models ?? [];
  if (own.length > 0) return new Set(own);
  return new Set((await listProxyModels()).data.map((m) => m.id));
}

// ---- keys ------------------------------------------------------------------

// /key/info is the only authority for which team a token belongs to; a token
// of another team, or one LiteLLM does not know, is a missing key (LT5).
export async function confirmKey(tokenId: string, litellmTeamId: string) {
  let row;
  try {
    row = (await getKey({ tokenId })).info;
  } catch (error) {
    if (
      error instanceof LiteLLMError &&
      error.detail === "upstream_error" &&
      (error.status === 404 || error.status === 400)
    ) {
      throw new NotFoundError(NOT_FOUND_MESSAGE);
    }
    throw error;
  }
  if (row.team_id !== litellmTeamId) throw new NotFoundError(NOT_FOUND_MESSAGE);
  return row;
}

// A key owned by a user above internal_user, or by the service user, is never
// touched (LT18, LD12).
export async function assertNotPrivileged(litellmUserId: string) {
  const role = (await getUser({ litellmUserId })).user_info?.user_role;
  if (!role || !NON_PRIVILEGED_ROLES.includes(role)) {
    throw new PrivilegedTargetError(litellmUserId);
  }
}

type KeySettingsInput = {
  models?: string[] | undefined;
  maxBudget?: number | undefined;
  rpmLimit?: number | undefined;
  tpmLimit?: number | undefined;
  maxParallelRequests?: number | undefined;
};

const lowest = (...values: Array<number | null | undefined>) => {
  const set = values.filter((v): v is number => v !== null && v !== undefined);
  return set.length === 0 ? null : Math.min(...set);
};

// A key's models are a subset of the team's, and its limits stay within the
// owner's membership and the team's (Budgets and limits; LT14).
export async function checkKeySettings(
  settings: KeySettingsInput,
  info: TeamInfo,
  ownerId: string | null | undefined,
): Promise<void> {
  const team = info.team_info;
  const owner: MemberRow | undefined = ownerId
    ? reduceMembers(info.team_memberships, emailsOf(info)).find(
        (m) => m.userId === ownerId,
      )
    : undefined;
  if (
    aboveCeiling(settings.maxBudget, lowest(owner?.maxBudget, team.max_budget))
  ) {
    throw badRequest(
      "The key budget is above the member's or the team's budget",
    );
  }
  if (
    aboveCeiling(settings.rpmLimit, lowest(owner?.rpmLimit, team.rpm_limit)) ||
    aboveCeiling(settings.tpmLimit, lowest(owner?.tpmLimit, team.tpm_limit))
  ) {
    throw badRequest("A key limit is above the member's or the team's limit");
  }
  if (
    aboveCeiling(
      settings.maxParallelRequests,
      lowest(owner?.maxParallelRequests, team.max_parallel_requests),
    )
  ) {
    throw badRequest("A key limit is above the member's or the team's limit");
  }
  if (settings.models) {
    const allowed = await allowedModels(info);
    if (settings.models.some((m) => !allowed.has(m))) {
      throw badRequest("A model is not available to the team");
    }
  }
}
