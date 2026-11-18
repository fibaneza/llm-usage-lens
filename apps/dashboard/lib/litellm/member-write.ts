import "server-only";

import { randomUUID } from "node:crypto";

import { auditCategory } from "@llm-usage-lens/shared";
import type {
  AuditAction,
  AuditSnapshot,
  LiteLLMOperationName,
} from "@llm-usage-lens/shared";
import type { Session } from "next-auth";
import type { ZodType } from "zod";

import { auditContext } from "@/lib/api/access-route";
import { IdParamSchema } from "@/lib/api/id-param";
import { matrixWrite } from "@/lib/api/matrix-route";
import type { MatrixArgs } from "@/lib/api/matrix-route";
import {
  BadRequestError,
  jsonData,
  jsonError,
  parseInput,
  parseJsonBody,
} from "@/lib/api/respond";
import { findTeamEntry } from "@/lib/api/team-directory";
import { appendAuditRecord, appendDeniedAudit } from "@/lib/data/access/audit";
import { getIdentityLink } from "@/lib/data/access/identity-links";
import {
  getIdentityRecord,
  listAllTeamMemberOids,
} from "@/lib/data/access/team-member-lookup";
import { recordMemberReset } from "@/lib/data/budget-resets-record";
import { getTeamLink } from "@/lib/data/litellm/team-links";

import { LiteLLMOperationRefused } from "./gateway";
import type { LiteLLMActor } from "./gateway";
import { LiteLLMUserNotSignedIn, findUserByEmail, getTeam } from "./operations";
import { enabledOperations, reduceMembers, requireEnabled } from "./read-views";
import type { MemberRow } from "./read-views";
import { liteLLMErrorResponse, openModeRefusal } from "./route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (member rows), "Identity
// mapping and members", "Budgets and limits", "Audit", LD2, LD10, LD13, LT5,
// LT13, LT18. The shared frame of the eight member-write routes: session and
// scope (matrix `member` write), path/body parse, team link (409), operation
// toggle (403), target resolution, the LiteLLM call, one audit record.

export type TeamInfo = Awaited<ReturnType<typeof getTeam>>;

export type MemberWriteResult = {
  data: Record<string, unknown>;
  // Overrides the audited target id (a person added by this call).
  targetId?: string;
  before?: AuditSnapshot;
  after?: AuditSnapshot;
};

export type MemberWriteContext<B> = {
  actor: LiteLLMActor;
  teamId: string;
  litellmTeamId: string;
  oid: string;
  body: B;
  teamInfo: TeamInfo;
  // Set for the routes that act on an existing LiteLLM team member.
  litellmUserId: string;
  member: MemberRow | null;
};

export type MemberWriteConfig<B> = {
  action: AuditAction;
  pattern: string;
  toggle: LiteLLMOperationName;
  status: 200 | 201;
  // `existing`: the oid is a person already in the LiteLLM team (resolved from
  // the stored link or the verified email). `dashboard-member`: the oid must be
  // a dashboard member of the team (add).
  target: "existing" | "dashboard-member";
  // The person acted on: the [oid] path parameter, or a field of the body.
  oidFrom: "path" | ((body: B) => string);
  body?: ZodType<B>;
  // A reset route: a BudgetReset ledger item is written with the audit record
  // (MG-D8). The ledger trigger is set by the server and a
  // client `?trigger=` is never read (review m4-r1 Q-W5).
  ledger?: "spend" | "budget";
};

// Thrown by an operation's execute when the LiteLLM user holds a proxy role
// above internal_user, or is the service user (LT18, LD12).
export class PrivilegedTargetError extends Error {
  constructor(readonly litellmUserId: string) {
    super("The target holds a privileged LiteLLM role");
    this.name = "PrivilegedTargetError";
  }
}

// LiteLLM roles a dashboard write may act on or for (LT18, LD12).
export const NON_PRIVILEGED_ROLES: readonly string[] = [
  "internal_user",
  "internal_user_viewer",
];

// A privileged target is refused with 409 and recorded as a denied attempt.
export async function refusePrivileged(
  request: Request,
  session: Session,
  config: { action: AuditAction; pattern: string },
  teamId: string,
  error: PrivilegedTargetError,
): Promise<Response> {
  await appendDeniedAudit({
    actor: session.user.oid,
    action: config.action,
    requestId: randomUUID(),
    code: "PRIVILEGED_TARGET",
    route: { method: request.method, pattern: config.pattern },
    target: { type: "litellm-user", id: error.litellmUserId },
    teamId,
  });
  return jsonError(
    409,
    "PRIVILEGED_TARGET",
    "The target holds a privileged LiteLLM role",
  );
}

export function badRequest(message: string): BadRequestError {
  return new BadRequestError([
    { code: "custom", message, path: [], input: undefined },
  ]);
}

const notFound = () => jsonError(404, "NOT_FOUND", "Not found");

// The LiteLLM user_id of a dashboard person (LD13): the stored link, else the
// id LiteLLM returns for the identity's verified email. Never composed here,
// and no IdentityLink is written.
export async function resolveLiteLLMUserId(
  oid: string,
): Promise<string | null> {
  const link = await getIdentityLink(oid);
  if (link?.litellmUserId) return link.litellmUserId;
  const email = (await getIdentityRecord(oid))?.email?.trim().toLowerCase();
  if (!email) return null;
  const { users } = await findUserByEmail({ email });
  return (
    users.find((u) => u.user_email?.toLowerCase() === email)?.user_id ?? null
  );
}

export function emailsOf(info: TeamInfo): Map<string, string> {
  return new Map(
    (info.team_info.members_with_roles ?? []).flatMap((m) =>
      m.user_id && m.user_email ? [[m.user_id, m.user_email] as const] : [],
    ),
  );
}

export async function audit(
  session: Session,
  config: { action: AuditAction },
  entry: {
    result: "success" | "failed";
    teamId: string;
    target: { type: string; id: string };
    before?: AuditSnapshot | undefined;
    after?: AuditSnapshot | undefined;
  },
): Promise<void> {
  await appendAuditRecord({
    actor: session.user.oid,
    action: config.action,
    category: "change",
    result: entry.result,
    timestamp: new Date().toISOString(),
    requestId: randomUUID(),
    teamId: entry.teamId,
    target: entry.target,
    ...(entry.before ? { before: entry.before } : {}),
    ...(entry.after ? { after: entry.after } : {}),
  });
}

// The amount is the member's spend read by the frame just before `execute`;
// a failed ledger write throws (Rule 60.17).
async function recordLedger(args: {
  session: Session;
  config: { action: AuditAction };
  operation: "spend" | "budget";
  meta: { teamId: string; departmentId: string };
  litellmTeamId: string;
  oid: string;
  member: MemberRow;
  result: MemberWriteResult;
}): Promise<void> {
  const { session, config, operation, meta, member, result } = args;
  const ctx = auditContext(session);
  const requestId = ctx.requestId;
  const timestamp = ctx.now.toISOString();
  await recordMemberReset(
    {
      resetId: randomUUID(),
      oid: args.oid,
      teamId: meta.teamId,
      departmentId: meta.departmentId,
      litellmTeamId: args.litellmTeamId,
      litellmUserId: member.userId,
      operation,
      amount: member.spend,
      budget: member.maxBudget,
      trigger: "direct",
      actorOid: session.user.oid,
      requestId,
      timestamp,
    },
    {
      actor: session.user.oid,
      action: config.action,
      category: auditCategory(config.action, "success"),
      result: "success",
      timestamp,
      requestId,
      teamId: meta.teamId,
      target: { type: "litellm-user", id: member.userId },
      ...(result.before ? { before: result.before } : {}),
      ...(result.after ? { after: result.after } : {}),
    },
  );
}

async function runMemberWrite<B>(
  config: MemberWriteConfig<B>,
  { request, params, session, refuse }: MatrixArgs,
  execute: (ctx: MemberWriteContext<B>) => Promise<MemberWriteResult>,
): Promise<Response> {
  const refused = openModeRefusal();
  if (refused) return refused;

  const teamId = parseInput(params.teamId, IdParamSchema);
  const meta = await findTeamEntry(teamId);
  const scopeRefusal = await refuse({
    operation: "member",
    team: meta ? { teamId, departmentId: meta.departmentId } : null,
  });
  if (scopeRefusal) return scopeRefusal;
  if (!meta) return notFound();

  const oidParam =
    config.oidFrom === "path" ? parseInput(params.oid, IdParamSchema) : "";
  const body = config.body
    ? await parseJsonBody(request, config.body)
    : (undefined as B);
  const oid =
    typeof config.oidFrom === "function" ? config.oidFrom(body) : oidParam;

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

  const actor: LiteLLMActor = {
    oid: session.user.oid,
    email: session.user.email ?? null,
  };
  let targetId = oid;
  let targetType = "person";
  try {
    let litellmUserId = "";
    let member: MemberRow | null = null;
    if (config.target === "dashboard-member") {
      const oids = await listAllTeamMemberOids(teamId);
      if (!oids.includes(oid)) return notFound();
    } else {
      const resolved = await resolveLiteLLMUserId(oid);
      if (!resolved) return notFound();
      litellmUserId = resolved;
      targetId = resolved;
      targetType = "litellm-user";
    }
    const teamInfo = await getTeam({ litellmTeamId });
    if (config.target === "existing") {
      member =
        reduceMembers(teamInfo.team_memberships, emailsOf(teamInfo)).find(
          (m) => m.userId === litellmUserId,
        ) ?? null;
      if (!member) return notFound();
    }

    const result = await execute({
      actor,
      teamId,
      litellmTeamId,
      oid,
      body,
      teamInfo,
      litellmUserId,
      member,
    });
    const finalId = result.targetId ?? targetId;
    if (config.ledger && member) {
      await recordLedger({
        session,
        config,
        operation: config.ledger,
        meta,
        litellmTeamId,
        oid,
        member,
        result,
      });
    } else {
      await audit(session, config, {
        result: "success",
        teamId,
        target: { type: "litellm-user", id: finalId },
        before: result.before,
        after: result.after,
      });
    }
    return jsonData(result.data, { status: config.status });
  } catch (error) {
    if (error instanceof PrivilegedTargetError) {
      return refusePrivileged(request, session, config, teamId, error);
    }
    if (error instanceof LiteLLMUserNotSignedIn) {
      return jsonError(
        409,
        "CONFLICT",
        "The person has not signed in to LiteLLM yet",
      );
    }
    const response = liteLLMErrorResponse(error);
    if (response) {
      if (!(error instanceof LiteLLMOperationRefused)) {
        await audit(session, config, {
          result: "failed",
          teamId,
          target: { type: targetType, id: targetId },
        });
      }
      return response;
    }
    throw error;
  }
}

// The route export: a matrix `member` write whose handler is the frame above.
export function memberWriteRoute<B = undefined>(
  config: MemberWriteConfig<B>,
  execute: (ctx: MemberWriteContext<B>) => Promise<MemberWriteResult>,
) {
  return matrixWrite(
    {
      operation: "member",
      action: config.action,
      pattern: config.pattern,
    },
    (args) => runMemberWrite(config, args, execute),
  );
}

// A snapshot value that is absent upstream is left out, never stored as null.
export function snapshot(
  values: Record<
    string,
    string | number | boolean | string[] | null | undefined
  >,
): AuditSnapshot {
  const out: AuditSnapshot = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}
