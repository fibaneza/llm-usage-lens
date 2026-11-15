import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  GSI1_NAME,
  IdentityRecordSchema,
  MemberAffiliationSchema,
} from "@llm-usage-lens/shared";
import type { IdentityRecord } from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { META_SK, identPk, membersGsi1pk } from "./keys";
import { getItem } from "./store";

// Source: docs/specs/2026-11-10-litellm.md - "Identity mapping and members"
// and Rule 20.6 (GSI1 queries loop on LastEvaluatedKey).

// Every member oid of a team, across all GSI1 pages.
export async function listAllTeamMemberOids(teamId: string): Promise<string[]> {
  const oids: string[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": membersGsi1pk(teamId),
          ":sk": "IDENT#",
        },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      oids.push(MemberAffiliationSchema.parse(item).oid);
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return oids;
}

export async function getIdentityRecord(
  oid: string,
): Promise<IdentityRecord | null> {
  const item = await getItem(identPk(oid), META_SK);
  return item ? IdentityRecordSchema.parse(item) : null;
}
