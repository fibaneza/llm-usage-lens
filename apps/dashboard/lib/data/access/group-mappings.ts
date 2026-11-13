import "server-only";

import {
  GroupMappingInputSchema,
  GroupMappingSchema,
} from "@llm-usage-lens/shared";
import type { GroupMapping, GroupMappingInput } from "@llm-usage-lens/shared";

import { getTableName } from "@/lib/dynamodb";

import { GROUPMAPS_GSI1PK, groupMapPk } from "./keys";
import { queryPage } from "./paging";
import type { AccessResult, AuditContext, ListOptions, Page } from "./result";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md — "Identity, SSO mapping and
// defaults" (a mapping grants a scoped role only, never a global one; T4),
// "Data model additions" (GroupMapping: PK=GROUPMAP#{groupId}, SK=META,
// gsi1pk=GROUPMAPS) and "Audit log" (groupmap.* change records).
const META_SK = "META";

const itemOf = (m: GroupMapping) => ({
  PK: groupMapPk(m.groupId),
  SK: META_SK,
  gsi1pk: GROUPMAPS_GSI1PK,
  gsi1sk: groupMapPk(m.groupId),
  ...m,
});

const snapshot = (m: GroupMapping) => ({
  groupId: m.groupId,
  target: m.target,
  scopedRole: m.scopedRole,
  version: m.version,
});

const auditTarget = (groupId: string) => ({
  type: "groupmap",
  id: groupId,
});

async function getMapping(groupId: string): Promise<GroupMapping | null> {
  const item = await getItem(groupMapPk(groupId), META_SK);
  return item ? GroupMappingSchema.parse(item) : null;
}

export async function listGroupMappings(
  options: ListOptions,
): Promise<AccessResult<Page<GroupMapping>>> {
  return queryPage({
    schema: GroupMappingSchema,
    options,
    index: "GSI1",
    partition: GROUPMAPS_GSI1PK,
  });
}

export async function createGroupMapping(
  input: GroupMappingInput,
  ctx: AuditContext,
): Promise<AccessResult<GroupMapping>> {
  const value: GroupMapping = {
    ...GroupMappingInputSchema.parse(input),
    version: 1,
    updatedAt: ctx.now.toISOString(),
  };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: itemOf(value),
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ],
    audit: {
      action: "groupmap.create",
      target: auditTarget(value.groupId),
      after: snapshot(value),
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}

export async function updateGroupMapping(
  input: GroupMappingInput & { version: number },
  ctx: AuditContext,
): Promise<AccessResult<GroupMapping>> {
  const parsed = GroupMappingInputSchema.parse(input);
  const current = await getMapping(parsed.groupId);
  if (!current) return { ok: false, code: "NOT_FOUND" };
  if (current.version !== input.version) return { ok: false, code: "CONFLICT" };
  const value: GroupMapping = {
    ...parsed,
    version: current.version + 1,
    updatedAt: ctx.now.toISOString(),
  };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: itemOf(value),
          ConditionExpression: "version = :v",
          ExpressionAttributeValues: { ":v": current.version },
        },
      },
    ],
    audit: {
      action: "groupmap.update",
      target: auditTarget(value.groupId),
      before: snapshot(current),
      after: snapshot(value),
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}

export async function deleteGroupMapping(
  input: { groupId: string; version: number },
  ctx: AuditContext,
): Promise<AccessResult<void>> {
  const current = await getMapping(input.groupId);
  if (!current) return { ok: false, code: "NOT_FOUND" };
  if (current.version !== input.version) return { ok: false, code: "CONFLICT" };
  const result = await commitAudited({
    items: [
      {
        Delete: {
          TableName: getTableName(),
          Key: { PK: groupMapPk(input.groupId), SK: META_SK },
          ConditionExpression: "version = :v",
          ExpressionAttributeValues: { ":v": input.version },
        },
      },
    ],
    audit: {
      action: "groupmap.delete",
      target: auditTarget(input.groupId),
      before: snapshot(current),
    },
    ctx,
  });
  return result.ok ? { ok: true, value: undefined } : result;
}
