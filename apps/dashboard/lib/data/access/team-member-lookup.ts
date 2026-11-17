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

// Every member oid of a team, across all GSI1 pages. Separate from
// affiliations.ts listTeamMembers on purpose: that one returns one cursor page
// of full items under a session scope; this reads every page, oids only.
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

// Pending (pre-staged) affiliations of a team: counted, never bound
// (App Teams spec - Member sum step 1). They share the team's GSI1 partition
// under a `PENDING#` sort key.
export async function countPendingAffiliations(
  teamId: string,
): Promise<number> {
  let count = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": membersGsi1pk(teamId),
          ":sk": "PENDING#",
        },
        Select: "COUNT",
        ExclusiveStartKey: startKey,
      }),
    );
    count += page.Count ?? 0;
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return count;
}

export async function getIdentityRecord(
  oid: string,
): Promise<IdentityRecord | null> {
  const item = await getItem(identPk(oid), META_SK);
  return item ? IdentityRecordSchema.parse(item) : null;
}
