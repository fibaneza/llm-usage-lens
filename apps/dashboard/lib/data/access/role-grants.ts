import "server-only";

import { RoleGrantSchema } from "@llm-usage-lens/shared";
import type { GrantableRole, RoleGrant } from "@llm-usage-lens/shared";

import { getTableName } from "@/lib/dynamodb";

import {
  ROLEGRANTS_GSI1PK,
  identPk,
  roleGrantGsi1sk,
  roleGrantSk,
} from "./keys";
import { queryPage } from "./paging";
import type { AccessResult, AuditContext, ListOptions, Page } from "./result";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md — "Data model additions"
// (RoleGrant) and "Audit log" (role.grant / role.revoke are security events).
const snapshot = (g: Pick<RoleGrant, "oid" | "role" | "version">) => ({
  oid: g.oid,
  role: g.role,
  version: g.version,
});

export async function grantRole(
  input: { oid: string; role: GrantableRole; reason: string },
  ctx: AuditContext,
): Promise<AccessResult<RoleGrant>> {
  const value: RoleGrant = {
    oid: input.oid,
    role: input.role,
    reason: input.reason,
    grantedBy: ctx.actor,
    grantedAt: ctx.now.toISOString(),
    version: 1,
  };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: {
            PK: identPk(input.oid),
            SK: roleGrantSk(input.role),
            gsi1pk: ROLEGRANTS_GSI1PK,
            gsi1sk: roleGrantGsi1sk(input.oid, input.role),
            ...value,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ],
    audit: {
      action: "role.grant",
      target: { type: "identity", id: input.oid },
      after: snapshot(value),
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}

export async function revokeRole(
  input: {
    oid: string;
    role: GrantableRole;
    version: number;
    // F5: another internal-admin grant that must still exist when the delete
    // commits, checked in the same transaction (no read-then-write gap).
    otherAdminOid?: string;
  },
  ctx: AuditContext,
): Promise<AccessResult<void>> {
  const Key = { PK: identPk(input.oid), SK: roleGrantSk(input.role) };
  const item = await getItem(Key.PK, Key.SK);
  if (!item) return { ok: false, code: "NOT_FOUND" };
  const current = RoleGrantSchema.parse(item);
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
      ...(input.otherAdminOid
        ? [
            {
              ConditionCheck: {
                TableName: getTableName(),
                Key: {
                  PK: identPk(input.otherAdminOid),
                  SK: roleGrantSk("internal-admin"),
                },
                ConditionExpression: "attribute_exists(PK)",
              },
            },
          ]
        : []),
    ],
    audit: {
      action: "role.revoke",
      target: { type: "identity", id: input.oid },
      before: snapshot(current),
    },
    ctx,
  });
  return result.ok ? { ok: true, value: undefined } : result;
}

export async function listRoleGrants(
  options: ListOptions,
): Promise<AccessResult<Page<RoleGrant>>> {
  return queryPage({
    schema: RoleGrantSchema,
    options,
    index: "GSI1",
    partition: ROLEGRANTS_GSI1PK,
  });
}
