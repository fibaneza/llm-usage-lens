import "server-only";

import { randomUUID } from "node:crypto";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  AppTeamSchema,
  GSI1_NAME,
  appTeamNameKey,
} from "@llm-usage-lens/shared";
import type { AppTeam } from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import {
  APPTEAMS_GSI1PK,
  META_SK,
  OWNER_SK,
  appTeamGsi1sk,
  appTeamNamePk,
  appTeamPk,
} from "./keys";
import type { AccessResult, AuditContext } from "./result";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AppTeam";
// docs/specs/2026-11-10-access-control.md — "Created app teams".
export async function createAppTeam(
  input: { name: string; departmentId: string; departmentName: string },
  ctx: AuditContext,
): Promise<AccessResult<AppTeam>> {
  const name = input.name.trim();
  const value: AppTeam = {
    teamId: `appteam-${randomUUID()}`,
    name,
    departmentId: input.departmentId,
    departmentName: input.departmentName,
    createdBy: ctx.actor,
    createdAt: ctx.now.toISOString(),
    version: 1,
  };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: {
            PK: appTeamPk(value.teamId),
            SK: META_SK,
            gsi1pk: APPTEAMS_GSI1PK,
            gsi1sk: appTeamGsi1sk(value.teamId),
            ...value,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
      {
        Put: {
          TableName: getTableName(),
          Item: {
            PK: appTeamNamePk(name),
            SK: OWNER_SK,
            teamId: value.teamId,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ],
    audit: {
      action: "appteam.create",
      target: { type: "team", id: value.teamId },
      teamId: value.teamId,
      after: { teamId: value.teamId, version: value.version },
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}

// Source: docs/specs/2026-11-10-access-control.md - "Edit a created team"
// (unit TP1). One transaction: the versioned META update, the name-claim move
// when the name key changes, and the audit item.
export async function updateAppTeam(
  teamId: string,
  input: {
    name: string;
    departmentId: string;
    departmentName: string;
    version: number;
  },
  ctx: AuditContext,
): Promise<AccessResult<AppTeam>> {
  const current = await getAppTeam(teamId);
  if (!current) return { ok: false, code: "NOT_FOUND" };
  const name = input.name.trim();
  const value: AppTeam = {
    ...current,
    name,
    departmentId: input.departmentId,
    departmentName: input.departmentName,
    version: input.version + 1,
  };
  const renamed = appTeamNameKey(current.name) !== appTeamNameKey(name);
  const result = await commitAudited({
    items: [
      {
        Update: {
          TableName: getTableName(),
          Key: { PK: appTeamPk(teamId), SK: META_SK },
          UpdateExpression:
            "SET #n = :n, departmentId = :d, departmentName = :dn, version = :next",
          ConditionExpression: "version = :v",
          ExpressionAttributeNames: { "#n": "name" },
          ExpressionAttributeValues: {
            ":n": name,
            ":d": value.departmentId,
            ":dn": value.departmentName,
            ":v": input.version,
            ":next": value.version,
          },
        },
      },
      ...(renamed
        ? [
            {
              Delete: {
                TableName: getTableName(),
                Key: { PK: appTeamNamePk(current.name), SK: OWNER_SK },
                ConditionExpression: "teamId = :t",
                ExpressionAttributeValues: { ":t": teamId },
              },
            },
            {
              Put: {
                TableName: getTableName(),
                Item: { PK: appTeamNamePk(name), SK: OWNER_SK, teamId },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
          ]
        : []),
    ],
    audit: {
      action: "appteam.update",
      target: { type: "team", id: teamId },
      teamId,
      before: { name: current.name, departmentId: current.departmentId },
      after: { name: value.name, departmentId: value.departmentId },
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}

export async function listAppTeams(): Promise<AppTeam[]> {
  const teams: AppTeam[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": APPTEAMS_GSI1PK },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) teams.push(AppTeamSchema.parse(item));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return teams;
}

export async function getAppTeam(teamId: string): Promise<AppTeam | null> {
  const item = await getItem(appTeamPk(teamId), META_SK);
  return item ? AppTeamSchema.parse(item) : null;
}

export async function hasAppTeamName(name: string): Promise<boolean> {
  return (await getItem(appTeamNamePk(name), OWNER_SK)) !== null;
}
