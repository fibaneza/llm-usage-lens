import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { GSI1_NAME, TeamLinkSchema } from "@llm-usage-lens/shared";
import type { TeamLink } from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import type { AccessResult, AuditContext } from "../access/result";
import { commitAudited, getItem } from "../access/store";

import {
  LITELLM_CLAIM_OWNER_SK,
  LITELLM_TEAMLINKS_GSI1PK,
  LITELLM_TEAMLINK_META_SK,
  teamLinkClaimPk,
  teamLinkGsi1sk,
  teamLinkPk,
} from "./keys";

// Source: docs/specs/2026-11-10-litellm.md — "Data model additions"
// (TeamLink at LITELLM#TEAMLINK#{teamId} / META with GSI1 LITELLM#TEAMLINKS /
// TEAM#{teamId}; TeamLinkClaim at LITELLM#LTEAM#{litellmTeamId} / OWNER makes
// the LiteLLM team_id unique; every item versioned; a link and its claim are
// written in one TransactWriteItems with the audit item), "Identity mapping"
// (one-to-one in v1, both directions unique), Rule 20.6.

function toLink(item: Record<string, unknown>): TeamLink {
  return TeamLinkSchema.parse({
    teamId: item.teamId,
    litellmTeamId: item.litellmTeamId,
    version: item.version,
    updatedAt: item.updatedAt,
  });
}

export async function getTeamLink(teamId: string): Promise<TeamLink | null> {
  const item = await getItem(teamLinkPk(teamId), LITELLM_TEAMLINK_META_SK);
  return item ? toLink(item) : null;
}

export async function listTeamLinks(): Promise<TeamLink[]> {
  const links: TeamLink[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": LITELLM_TEAMLINKS_GSI1PK },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) links.push(toLink(item));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return links;
}

// `version: null` creates the link; otherwise it must equal the stored
// version. A LiteLLM team already claimed by another dashboard team, or a
// stale version, is CONFLICT and writes nothing.
export async function putTeamLink(
  input: { teamId: string; litellmTeamId: string; version: number | null },
  ctx: AuditContext,
): Promise<AccessResult<TeamLink>> {
  const current = await getTeamLink(input.teamId);
  if ((current?.version ?? null) !== input.version) {
    return { ok: false, code: "CONFLICT" };
  }
  const value = TeamLinkSchema.parse({
    teamId: input.teamId,
    litellmTeamId: input.litellmTeamId,
    version: (current?.version ?? 0) + 1,
    updatedAt: ctx.now.toISOString(),
  });
  const sameTarget = current?.litellmTeamId === value.litellmTeamId;
  const claimPut = {
    Put: {
      TableName: getTableName(),
      Item: {
        PK: teamLinkClaimPk(value.litellmTeamId),
        SK: LITELLM_CLAIM_OWNER_SK,
        teamId: value.teamId,
        version: 1,
        updatedAt: value.updatedAt,
      },
      ...(sameTarget
        ? {}
        : { ConditionExpression: "attribute_not_exists(PK)" }),
    },
  };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: {
            PK: teamLinkPk(value.teamId),
            SK: LITELLM_TEAMLINK_META_SK,
            gsi1pk: LITELLM_TEAMLINKS_GSI1PK,
            gsi1sk: teamLinkGsi1sk(value.teamId),
            ...value,
          },
          ...(current
            ? {
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": current.version },
              }
            : { ConditionExpression: "attribute_not_exists(PK)" }),
        },
      },
      claimPut,
      ...(current && !sameTarget
        ? [
            {
              Delete: {
                TableName: getTableName(),
                Key: {
                  PK: teamLinkClaimPk(current.litellmTeamId),
                  SK: LITELLM_CLAIM_OWNER_SK,
                },
                ConditionExpression: "teamId = :me",
                ExpressionAttributeValues: { ":me": value.teamId },
              },
            },
          ]
        : []),
    ],
    audit: {
      action: "litellm.teamlink.link",
      target: { type: "litellm-team-link", id: value.teamId },
      teamId: value.teamId,
      ...(current
        ? {
            before: {
              version: current.version,
              litellmTeamId: current.litellmTeamId,
            },
          }
        : {}),
      after: { version: value.version, litellmTeamId: value.litellmTeamId },
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}

export async function deleteTeamLink(
  teamId: string,
  ctx: AuditContext,
): Promise<AccessResult<{ teamId: string }>> {
  const current = await getTeamLink(teamId);
  if (!current) return { ok: false, code: "NOT_FOUND" };
  const result = await commitAudited({
    items: [
      {
        Delete: {
          TableName: getTableName(),
          Key: {
            PK: teamLinkPk(teamId),
            SK: LITELLM_TEAMLINK_META_SK,
          },
          ConditionExpression: "version = :v",
          ExpressionAttributeValues: { ":v": current.version },
        },
      },
      {
        Delete: {
          TableName: getTableName(),
          Key: {
            PK: teamLinkClaimPk(current.litellmTeamId),
            SK: LITELLM_CLAIM_OWNER_SK,
          },
        },
      },
    ],
    audit: {
      action: "litellm.teamlink.unlink",
      target: { type: "litellm-team-link", id: teamId },
      teamId,
      before: {
        version: current.version,
        litellmTeamId: current.litellmTeamId,
      },
    },
    ctx,
  });
  return result.ok ? { ok: true, value: { teamId } } : result;
}
