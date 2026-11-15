import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { GSI1_NAME, RoleGrantSchema } from "@llm-usage-lens/shared";
import type { GrantableRole, RoleGrant } from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import {
  LOCALUSERS_GSI1PK,
  META_SK,
  ROLEGRANTS_GSI1PK,
  identPk,
  localUserPk,
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
    // T33: when that holder is a password user, its LOCALUSER must also still
    // be not disabled when the delete commits.
    otherAdminEmail?: string;
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
            ...(input.otherAdminEmail
              ? [
                  {
                    ConditionCheck: {
                      TableName: getTableName(),
                      Key: {
                        PK: localUserPk(input.otherAdminEmail),
                        SK: META_SK,
                      },
                      ConditionExpression: "#s <> :disabled",
                      ExpressionAttributeNames: { "#s": "status" },
                      ExpressionAttributeValues: { ":disabled": "disabled" },
                    },
                  },
                ]
              : []),
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

export async function roleGrantExists(
  oid: string,
  role: GrantableRole,
): Promise<boolean> {
  return (await getItem(identPk(oid), roleGrantSk(role))) !== null;
}

async function queryAllGsi1(
  partition: string,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": partition },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}

// The lowest-oid internal-admin holder other than `oid` that can still sign in
// (Access Control spec - Roles; last-admin rule): a password user counts only
// while its LOCALUSER is not disabled, an Entra holder (no LOCALUSER) always
// counts. `localUserEmail` is set for a password user so the revoke can guard
// its status (T33). Null when there is none.
export async function findOtherActiveAdmin(
  oid: string,
): Promise<{ oid: string; localUserEmail?: string } | null> {
  const [grants, localUsers] = await Promise.all([
    queryAllGsi1(ROLEGRANTS_GSI1PK),
    queryAllGsi1(LOCALUSERS_GSI1PK),
  ]);
  const localByOid = new Map(
    localUsers.map((u) => [String(u.oid), u] as const),
  );
  let best: { oid: string; localUserEmail?: string } | null = null;
  for (const grant of grants) {
    if (grant.role !== "internal-admin" || grant.oid === oid) continue;
    const holderOid = String(grant.oid);
    const local = localByOid.get(holderOid);
    if (local?.status === "disabled") continue;
    if (best === null || holderOid < best.oid) {
      best = {
        oid: holderOid,
        ...(local ? { localUserEmail: String(local.email) } : {}),
      };
    }
  }
  return best;
}
