import "server-only";

import { randomUUID } from "node:crypto";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AppTeamSchema, GSI1_NAME } from "@llm-usage-lens/shared";
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
