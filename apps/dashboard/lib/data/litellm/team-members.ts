import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  GSI1_NAME,
  IdentityRecordSchema,
  MemberAffiliationSchema,
} from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { getIdentityLink } from "../access/identity-links";
import { META_SK, identPk, membersGsi1pk } from "../access/keys";
import { getItem } from "../access/store";

// Source: docs/specs/2026-11-10-litellm.md — "Identity mapping and members"
// (members are dashboard members of the team; the user link is
// `IdentityLink.litellmUserId`, falling back to the usage identities) and
// Rule 20.6 (GSI1 queries loop on LastEvaluatedKey).

export type DashboardMember = { oid: string; name?: string };

// LiteLLM user id or email (lower-cased) -> the dashboard member it belongs to.
export async function mapTeamMembers(
  teamId: string,
): Promise<Map<string, DashboardMember>> {
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

  const byKey = new Map<string, DashboardMember>();
  await Promise.all(
    oids.map(async (oid) => {
      const [link, item] = await Promise.all([
        getIdentityLink(oid),
        getItem(identPk(oid), META_SK),
      ]);
      const identity = item ? IdentityRecordSchema.parse(item) : null;
      const member: DashboardMember = {
        oid,
        ...(identity?.displayName ? { name: identity.displayName } : {}),
      };
      const keys = [
        link?.litellmUserId,
        identity?.email,
        ...(link?.usageIdentities ?? []),
      ];
      for (const key of keys) {
        if (key) byKey.set(key.toLowerCase(), member);
      }
    }),
  );
  return byKey;
}
