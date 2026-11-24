import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  GSI1_NAME,
  IdentityLinkSchema,
  IdentityRecordSchema,
  MemberAffiliationSchema,
  runBounded,
} from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import {
  AFFILIATION_SK,
  IDENTS_GSI1PK,
  LINK_SK,
  LOCALUSERS_GSI1PK,
  identPk,
} from "./keys";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user sync"
// (*Users*: the identities the sync compares; *Match keys per sign-in mode*,
// SM3, SM4: an Entra identity and a password user, never the master user or a
// dev login; *Preview and apply*: at most 2,000 identities), Rule 20.6
// (paginate on LastEvaluatedKey), Enforcement item 4 (read per request, never
// cached). Read-only; returns what the sync needs and no credential, lockout
// state or token.
export const SYNC_PEOPLE_BOUND = 2000;
const READ_CONCURRENCY = 10;

export type SyncPerson = {
  oid: string;
  authMethod: "entra" | "password";
  tid?: string;
  upn?: string;
  email?: string;
  expectedOid?: string;
  litellmUserId: string | null;
  linkVersion: number | null;
  affiliation: { teamId: string; source: "sso" | "ui" } | null;
};

async function queryAll(
  input: Omit<ConstructorParameters<typeof QueryCommand>[0], "TableName">,
  stopAfter?: number,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        ...input,
        TableName: getTableName(),
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey && (stopAfter === undefined || items.length <= stopAfter));
  return items;
}

type Draft = Omit<SyncPerson, "litellmUserId" | "linkVersion" | "affiliation">;

export async function listSyncPeople(
  bound: number = SYNC_PEOPLE_BOUND,
): Promise<{ people: SyncPerson[]; truncated: boolean }> {
  const [identityItems, localItems] = await Promise.all([
    queryAll(
      {
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :sk)",
        ExpressionAttributeValues: { ":pk": IDENTS_GSI1PK, ":sk": "IDENT#" },
      },
      bound,
    ),
    queryAll(
      {
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": LOCALUSERS_GSI1PK },
      },
      bound,
    ),
  ]);

  const drafts = new Map<string, Draft>();
  for (const item of identityItems) {
    const identity = IdentityRecordSchema.parse(item);
    if (identity.authMethod === "entra") {
      drafts.set(identity.oid, {
        oid: identity.oid,
        authMethod: "entra",
        tid: identity.tid,
        ...(identity.upn ? { upn: identity.upn } : {}),
        ...(identity.email ? { email: identity.email } : {}),
      });
    } else if (identity.authMethod === "password") {
      drafts.set(identity.oid, {
        oid: identity.oid,
        authMethod: "password",
        ...(identity.email ? { email: identity.email } : {}),
      });
    }
  }
  // A password user not bound to Entra yet is a person by its sign-in email,
  // with the reserved expected oid when an admin set one; a bound one is
  // represented by its Entra identity.
  for (const item of localItems) {
    if (item.status === "sso-bound") continue;
    const oid = String(item.oid);
    const sso = (item.sso ?? {}) as Record<string, unknown>;
    drafts.set(oid, {
      oid,
      authMethod: "password",
      email: String(item.email),
      ...(typeof sso.expectedOid === "string"
        ? { expectedOid: sso.expectedOid }
        : {}),
    });
  }

  const all = [...drafts.values()];
  const truncated = all.length > bound;
  const kept = all.slice(0, bound);
  const people: SyncPerson[] = [];
  await runBounded(kept, READ_CONCURRENCY, async (draft) => {
    const items = await queryAll({
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": identPk(draft.oid) },
    });
    const linkItem = items.find((i) => i.SK === LINK_SK);
    const affItem = items.find((i) => i.SK === AFFILIATION_SK);
    const link = linkItem ? IdentityLinkSchema.parse(linkItem) : null;
    const affiliation = affItem ? MemberAffiliationSchema.parse(affItem) : null;
    people.push({
      ...draft,
      litellmUserId: link?.litellmUserId ?? null,
      linkVersion: link?.version ?? null,
      affiliation: affiliation
        ? { teamId: affiliation.teamId, source: affiliation.source }
        : null,
    });
  });
  people.sort((a, b) => a.oid.localeCompare(b.oid));
  return { people, truncated };
}
