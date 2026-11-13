import "server-only";

import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import {
  DEFAULT_DEPARTMENT_VISIBILITY,
  DEFAULT_TEAM_VISIBILITY,
  DepartmentVisibilitySchema,
  TeamVisibilitySchema,
} from "@llm-usage-lens/shared";
import type {
  DepartmentVisibility,
  TeamVisibility,
} from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { visibilityPk } from "./keys";
import type { ScopeType } from "./keys";
import type { AccessResult, AuditContext } from "./result";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md — "Visibility" (defaults
// apply when no item exists: team visible/own, department hidden/own; the
// default carries version 0) and "Data model additions" (VIS#…/META).
const META_SK = "META";
const BATCH_SIZE = 100;

async function batchGetVisibility(
  keys: ReadonlyArray<{ PK: string; SK: string }>,
): Promise<Record<string, unknown>[]> {
  const found: Record<string, unknown>[] = [];
  const table = getTableName();
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    let pending: Array<{ PK: string; SK: string }> | undefined = keys.slice(
      i,
      i + BATCH_SIZE,
    );
    while (pending && pending.length > 0) {
      const res = await getDocumentClient().send(
        new BatchGetCommand({ RequestItems: { [table]: { Keys: pending } } }),
      );
      found.push(...(res.Responses?.[table] ?? []));
      pending = res.UnprocessedKeys?.[table]?.Keys as
        | Array<{ PK: string; SK: string }>
        | undefined;
    }
  }
  return found;
}

export async function getVisibility(input: {
  teamIds: readonly string[];
  departmentIds: readonly string[];
}): Promise<{
  teams: Map<string, TeamVisibility>;
  departments: Map<string, DepartmentVisibility>;
}> {
  const teamIds = [...new Set(input.teamIds)];
  const departmentIds = [...new Set(input.departmentIds)];
  const items = await batchGetVisibility([
    ...teamIds.map((id) => ({ PK: visibilityPk("team", id), SK: META_SK })),
    ...departmentIds.map((id) => ({
      PK: visibilityPk("department", id),
      SK: META_SK,
    })),
  ]);
  const byPk = new Map(items.map((item) => [String(item.PK), item]));

  const teams = new Map<string, TeamVisibility>();
  for (const id of teamIds) {
    const stored = byPk.get(visibilityPk("team", id));
    teams.set(
      id,
      stored
        ? TeamVisibilitySchema.parse(stored)
        : {
            teamId: id,
            ...DEFAULT_TEAM_VISIBILITY,
            version: 0,
            updatedAt: new Date(0).toISOString(),
          },
    );
  }
  const departments = new Map<string, DepartmentVisibility>();
  for (const id of departmentIds) {
    const stored = byPk.get(visibilityPk("department", id));
    departments.set(
      id,
      stored
        ? DepartmentVisibilitySchema.parse(stored)
        : {
            departmentId: id,
            ...DEFAULT_DEPARTMENT_VISIBILITY,
            version: 0,
            updatedAt: new Date(0).toISOString(),
          },
    );
  }
  return { teams, departments };
}

type Subject = { scopeType: ScopeType; id: string };

async function putVisibility<T extends { version: number }>(
  subject: Subject,
  fields: Record<string, string>,
  expected: number | null,
  parse: (item: unknown) => T,
  ctx: AuditContext,
): Promise<AccessResult<T>> {
  const key = { PK: visibilityPk(subject.scopeType, subject.id), SK: META_SK };
  let before: T | null = null;
  if (expected !== null) {
    const stored = await getItem(key.PK, key.SK);
    if (!stored) return { ok: false, code: "NOT_FOUND" };
    before = parse(stored);
    if (before.version !== expected) return { ok: false, code: "CONFLICT" };
  }
  const value = parse({
    ...fields,
    version: (before?.version ?? 0) + 1,
    updatedAt: ctx.now.toISOString(),
  });
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: { ...key, ...value },
          ...(before
            ? {
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": before.version },
              }
            : { ConditionExpression: "attribute_not_exists(PK)" }),
        },
      },
    ],
    audit: {
      action: "visibility.update",
      target: { type: subject.scopeType, id: subject.id },
      ...(subject.scopeType === "team" ? { teamId: subject.id } : {}),
      ...(before ? { before: snapshot(before) } : {}),
      after: snapshot(value),
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}

function snapshot(value: { version: number }): Record<string, string | number> {
  const out: Record<string, string | number> = { version: value.version };
  for (const k of [
    "teamLevel",
    "userLevel",
    "departmentLevel",
    "maxUserLevel",
  ] as const) {
    const v = (value as Record<string, unknown>)[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function putTeamVisibility(
  input: Pick<TeamVisibility, "teamId" | "teamLevel" | "userLevel"> & {
    version: number | null;
  },
  ctx: AuditContext,
): Promise<AccessResult<TeamVisibility>> {
  return putVisibility(
    { scopeType: "team", id: input.teamId },
    {
      teamId: input.teamId,
      teamLevel: input.teamLevel,
      userLevel: input.userLevel,
    },
    input.version,
    (item) => TeamVisibilitySchema.parse(item),
    ctx,
  );
}

export function putDepartmentVisibility(
  input: Pick<
    DepartmentVisibility,
    "departmentId" | "departmentLevel" | "maxUserLevel"
  > & { version: number | null },
  ctx: AuditContext,
): Promise<AccessResult<DepartmentVisibility>> {
  return putVisibility(
    { scopeType: "department", id: input.departmentId },
    {
      departmentId: input.departmentId,
      departmentLevel: input.departmentLevel,
      maxUserLevel: input.maxUserLevel,
    },
    input.version,
    (item) => DepartmentVisibilitySchema.parse(item),
    ctx,
  );
}
