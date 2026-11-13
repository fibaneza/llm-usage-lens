import "server-only";

import { AdminScopeSchema } from "@llm-usage-lens/shared";
import type { AdminScope } from "@llm-usage-lens/shared";

import { getTableName } from "@/lib/dynamodb";

import { adminScopeSk, adminsGsi1pk, identPk } from "./keys";
import type { ScopeType } from "./keys";
import { queryPage } from "./paging";
import type { AccessResult, AuditContext, ListOptions, Page } from "./result";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md — "Membership, admin scopes
// and lifecycle"; contract R2 decision 8 (one item per scope key).
type ScopeRef = { scopeType: ScopeType; scopeId: string };

const snapshot = (s: AdminScope) => ({
  oid: s.oid,
  scopeType: s.scopeType,
  scopeId: s.scopeId,
  source: s.source,
  version: s.version,
});

const auditTarget = (oid: string, ref: ScopeRef) => ({
  target: { type: "identity", id: oid },
  ...(ref.scopeType === "team" ? { teamId: ref.scopeId } : {}),
});

export async function grantAdminScope(
  input: { oid: string } & ScopeRef,
  ctx: AuditContext,
): Promise<AccessResult<AdminScope>> {
  const value: AdminScope = {
    oid: input.oid,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    source: "ui",
    version: 1,
    createdAt: ctx.now.toISOString(),
    createdBy: ctx.actor,
  };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: {
            PK: identPk(input.oid),
            SK: adminScopeSk(input.scopeType, input.scopeId),
            gsi1pk: adminsGsi1pk(input.scopeType, input.scopeId),
            gsi1sk: identPk(input.oid),
            ...value,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ],
    audit: {
      action: "adminscope.grant",
      ...auditTarget(input.oid, input),
      after: snapshot(value),
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}

export async function revokeAdminScope(
  input: { oid: string; version: number } & ScopeRef,
  ctx: AuditContext,
): Promise<AccessResult<void>> {
  const Key = {
    PK: identPk(input.oid),
    SK: adminScopeSk(input.scopeType, input.scopeId),
  };
  const item = await getItem(Key.PK, Key.SK);
  if (!item) return { ok: false, code: "NOT_FOUND" };
  const current = AdminScopeSchema.parse(item);
  if (current.source === "sso") return { ok: false, code: "MANAGED_BY_SSO" };
  if (current.version !== input.version) return { ok: false, code: "CONFLICT" };
  const result = await commitAudited({
    items: [
      {
        Delete: {
          TableName: getTableName(),
          Key,
          ConditionExpression: "version = :v",
          ExpressionAttributeValues: { ":v": input.version },
        },
      },
    ],
    audit: {
      action: "adminscope.revoke",
      ...auditTarget(input.oid, input),
      before: snapshot(current),
    },
    ctx,
  });
  return result.ok ? { ok: true, value: undefined } : result;
}

export async function listAdminScopes(
  oid: string,
  options: ListOptions,
): Promise<AccessResult<Page<AdminScope>>> {
  return queryPage({
    schema: AdminScopeSchema,
    options,
    partition: identPk(oid),
    sortPrefix: "ADMINSCOPE#",
  });
}

export async function listScopeAdmins(
  ref: ScopeRef,
  options: ListOptions,
): Promise<AccessResult<Page<AdminScope>>> {
  return queryPage({
    schema: AdminScopeSchema,
    options,
    index: "GSI1",
    partition: adminsGsi1pk(ref.scopeType, ref.scopeId),
    sortPrefix: "IDENT#",
  });
}
