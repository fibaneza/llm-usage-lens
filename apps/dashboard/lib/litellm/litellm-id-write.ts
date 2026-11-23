import "server-only";

import { randomUUID } from "node:crypto";

import { auditCategory } from "@llm-usage-lens/shared";
import type { AuditAction, LiteLLMOperationName } from "@llm-usage-lens/shared";
import type { Session } from "next-auth";

import { auditContext } from "@/lib/api/access-route";
import { IdParamSchema } from "@/lib/api/id-param";
import { matrixWrite, notFoundResponse } from "@/lib/api/matrix-route";
import type { MatrixArgs } from "@/lib/api/matrix-route";
import { jsonData, jsonError, parseInput } from "@/lib/api/respond";
import { findTeamEntry } from "@/lib/api/team-directory";
import { decideWrite, isMatrixWriter } from "@/lib/auth/write-policy";
import { appendAuditRecord, appendDeniedAudit } from "@/lib/data/access/audit";
import { getLiteLLMUserOwner } from "@/lib/data/access/identity-links";
import { recordMemberReset } from "@/lib/data/budget-resets-record";
import { listTeamLinks } from "@/lib/data/litellm/team-links";

import { LiteLLMError } from "./client";
import { LiteLLMOperationRefused } from "./gateway";
import { NON_PRIVILEGED_ROLES } from "./member-write";
import {
  getTeam,
  getUser,
  resetMemberBudget,
  resetMemberSpend,
  resetUserSpend,
} from "./operations";
import {
  LiteLLMUserIdSchema,
  enabledOperations,
  reduceMembers,
  requireEnabled,
} from "./read-views";
import { liteLLMErrorResponse, openModeRefusal } from "./route-guard";

// Source: docs/specs/2026-11-10-litellm.md - LD39, LT5, LT35-LT37, "Writes"
// (resetUserSpend, resetMemberSpend, resetMemberBudget), "API routes";
// Access Control - "Reset by LiteLLM ids"; Data Model - BudgetReset. The shared
// frame of the three resets keyed by LiteLLM ids: matrix permission (`member`),
// path ids, toggle, target, privileged check, the one LiteLLM write, one audit
// record and one ledger item in a single transaction (MG-D8).

type IdWriteConfig = {
  action: AuditAction;
  pattern: string;
  toggle: LiteLLMOperationName;
};

// Path ids are 1-128 characters (Data Model - API Routes) and a LiteLLM id.
export const PathLiteLLMId = IdParamSchema.pipe(LiteLLMUserIdSchema);

type TeamRef = { teamId: string; departmentId: string };

// The app teams linked to a LiteLLM team the caller may reset members of.
async function reachableTeams(
  args: MatrixArgs,
  litellmTeamIds: ReadonlySet<string>,
): Promise<TeamRef[]> {
  const links = (await listTeamLinks()).filter((l) =>
    litellmTeamIds.has(l.litellmTeamId),
  );
  const teams: TeamRef[] = [];
  for (const link of links) {
    const meta = await findTeamEntry(link.teamId);
    if (!meta) continue;
    const team = { teamId: link.teamId, departmentId: meta.departmentId };
    if (decideWrite(args.actor, { operation: "member", team }) === "allow") {
      teams.push(team);
    }
  }
  return teams;
}

async function refuseDenied(
  args: MatrixArgs,
  config: IdWriteConfig,
  code: "FORBIDDEN" | "PRIVILEGED_TARGET" | "NOT_FOUND",
  target?: { type: string; id: string },
  teamId?: string,
): Promise<void> {
  await appendDeniedAudit({
    actor: args.session.user.oid,
    action: config.action,
    requestId: randomUUID(),
    code,
    route: { method: args.request.method, pattern: config.pattern },
    ...(target ? { target } : {}),
    ...(teamId ? { teamId } : {}),
  });
}

const forbidden = () => jsonError(403, "FORBIDDEN", "Insufficient permission");

async function enabledOrRefusal(
  toggle: LiteLLMOperationName,
): Promise<Response | null> {
  try {
    requireEnabled(await enabledOperations(), [toggle]);
    return null;
  } catch (error) {
    const response = liteLLMErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

async function failed(
  session: Session,
  config: IdWriteConfig,
  target: { type: string; id: string },
  error: unknown,
  teamId?: string,
): Promise<Response | null> {
  const response = liteLLMErrorResponse(error);
  if (!response) return null;
  if (!(error instanceof LiteLLMOperationRefused)) {
    await appendAuditRecord({
      actor: session.user.oid,
      action: config.action,
      category: "change",
      result: "failed",
      timestamp: new Date().toISOString(),
      requestId: randomUUID(),
      target,
      ...(teamId ? { teamId } : {}),
    });
  }
  return response;
}

const isNotFound = (error: unknown) =>
  error instanceof LiteLLMError && error.status === 404;

// ---- resetUserSpend: POST /api/litellm/users/[litellmUserId]/reset-spend -----

export function userResetSpendRoute(config: IdWriteConfig) {
  return matrixWrite(
    { operation: "member", action: config.action, pattern: config.pattern },
    async (args) => {
      const { params, session, actor } = args;
      const refused = openModeRefusal();
      if (refused) return refused;
      const litellmUserId = parseInput(params.litellmUserId, PathLiteLLMId);
      const disabled = await enabledOrRefusal(config.toggle);
      if (disabled) return disabled;

      const target = { type: "litellm-user", id: litellmUserId };
      try {
        const info = await getUser({ litellmUserId }).catch(
          (error: unknown) => {
            if (isNotFound(error)) return null;
            throw error;
          },
        );
        if (!info) return notFoundResponse();
        const personTeams = new Set(
          info.teams.flatMap((t) =>
            typeof t.team_id === "string" ? [t.team_id] : [],
          ),
        );
        const reachable = await reachableTeams(args, personTeams);
        if (!isMatrixWriter(actor.roles)) {
          if (reachable.length === 0) {
            await refuseDenied(args, config, "NOT_FOUND", target);
            return notFoundResponse();
          }
        }
        const team: TeamRef | undefined = reachable[0];

        const role = info.user_info?.user_role;
        if (!role || !NON_PRIVILEGED_ROLES.includes(role)) {
          await refuseDenied(args, config, "PRIVILEGED_TARGET", target);
          return jsonError(
            409,
            "PRIVILEGED_TARGET",
            "The target holds a privileged LiteLLM role",
          );
        }

        const spend = info.user_info?.spend ?? 0;
        await resetUserSpend(
          { litellmUserId },
          {
            actor: { oid: session.user.oid, email: session.user.email ?? null },
          },
        );
        const oid = await getLiteLLMUserOwner(litellmUserId);
        const ctx = auditContext(session);
        await recordMemberReset(
          {
            scope: "user",
            resetId: randomUUID(),
            ...(oid ? { oid } : {}),
            litellmUserId,
            operation: "spend",
            amount: spend,
            budget: info.user_info?.max_budget ?? null,
            trigger: "direct",
            actorOid: session.user.oid,
            requestId: ctx.requestId,
            timestamp: ctx.now.toISOString(),
          },
          {
            actor: session.user.oid,
            action: config.action,
            category: auditCategory(config.action, "success"),
            result: "success",
            timestamp: ctx.now.toISOString(),
            requestId: ctx.requestId,
            ...(team ? { teamId: team.teamId } : {}),
            target,
            before: { spend },
            after: { spend: 0 },
          },
        );
        return jsonData({ litellmUserId });
      } catch (error) {
        const response = await failed(session, config, target, error);
        if (response) return response;
        throw error;
      }
    },
  );
}

// ---- resetMemberSpend / resetMemberBudget by LiteLLM team and user id --------

export function proxyMemberResetRoute(
  config: IdWriteConfig & { operation: "spend" | "budget" },
) {
  return matrixWrite(
    { operation: "member", action: config.action, pattern: config.pattern },
    async (args) => {
      const { params, session, actor } = args;
      const refused = openModeRefusal();
      if (refused) return refused;
      const litellmTeamId = parseInput(params.litellmTeamId, PathLiteLLMId);
      const litellmUserId = parseInput(params.litellmUserId, PathLiteLLMId);

      // A Lead acts only on a LiteLLM team linked to a team in scope; org-admin
      // and Admin on every LiteLLM team, linked or not (D-RS3).
      const reachable = await reachableTeams(args, new Set([litellmTeamId]));
      if (!isMatrixWriter(actor.roles) && reachable.length === 0) {
        await refuseDenied(args, config, "FORBIDDEN");
        return forbidden();
      }
      const team = reachable[0];

      const disabled = await enabledOrRefusal(config.toggle);
      if (disabled) return disabled;

      const target = { type: "litellm-user", id: litellmUserId };
      try {
        const teamInfo = await getTeam({ litellmTeamId }).catch(
          (error: unknown) => {
            if (isNotFound(error)) return null;
            throw error;
          },
        );
        if (!teamInfo) return notFoundResponse();
        const emails = new Map(
          (teamInfo.team_info.members_with_roles ?? []).flatMap((m) =>
            m.user_id && m.user_email
              ? [[m.user_id, m.user_email] as const]
              : [],
          ),
        );
        const member = reduceMembers(teamInfo.team_memberships, emails).find(
          (m) => m.userId === litellmUserId,
        );
        if (!member) return notFoundResponse();

        const info = await getUser({ litellmUserId }).catch(
          (error: unknown) => {
            if (isNotFound(error)) return null;
            throw error;
          },
        );
        if (!info) return notFoundResponse();
        const role = info.user_info?.user_role;
        if (!role || !NON_PRIVILEGED_ROLES.includes(role)) {
          await refuseDenied(
            args,
            config,
            "PRIVILEGED_TARGET",
            target,
            team?.teamId,
          );
          return jsonError(
            409,
            "PRIVILEGED_TARGET",
            "The target holds a privileged LiteLLM role",
          );
        }

        const input = { litellmTeamId, litellmUserId };
        const context = {
          actor: { oid: session.user.oid, email: session.user.email ?? null },
        };
        let data: Record<string, unknown> = { litellmUserId };
        let before: Record<string, number | string> = {};
        let after: Record<string, number | string> = {};
        if (config.operation === "spend") {
          await resetMemberSpend(input, context);
          before = { spend: member.spend };
          after = { spend: 0 };
        } else {
          const { budgetId, previousBudgetId } = await resetMemberBudget(
            input,
            context,
          );
          data = { litellmUserId, budgetId, previousBudgetId };
          if (previousBudgetId) before = { budgetId: previousBudgetId };
          if (budgetId) after = { budgetId };
        }

        const oid = await getLiteLLMUserOwner(litellmUserId);
        const ctx = auditContext(session);
        await recordMemberReset(
          {
            scope: "member",
            resetId: randomUUID(),
            ...(oid ? { oid } : {}),
            ...(team
              ? { teamId: team.teamId, departmentId: team.departmentId }
              : {}),
            litellmTeamId,
            litellmUserId,
            operation: config.operation,
            amount: member.spend,
            budget: member.maxBudget,
            trigger: "direct",
            actorOid: session.user.oid,
            requestId: ctx.requestId,
            timestamp: ctx.now.toISOString(),
          },
          {
            actor: session.user.oid,
            action: config.action,
            category: auditCategory(config.action, "success"),
            result: "success",
            timestamp: ctx.now.toISOString(),
            requestId: ctx.requestId,
            ...(team ? { teamId: team.teamId } : {}),
            target,
            before,
            after,
          },
        );
        return jsonData(data);
      } catch (error) {
        const response = await failed(
          session,
          config,
          target,
          error,
          team?.teamId,
        );
        if (response) return response;
        throw error;
      }
    },
  );
}
