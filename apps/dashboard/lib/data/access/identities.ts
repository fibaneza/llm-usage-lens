import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { GSI1_NAME, IdentityRecordSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { IDENTS_GSI1PK, META_SK, identPk } from "./keys";
import { queryPage } from "./paging";
import type { AccessResult, ListOptions, Page } from "./result";
import { getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/identities), "Data model additions" (Query GSI1=IDENTS). The list row
// is a pick of the identity record: lockout state, tenant and roles never
// leave this module.
export const IdentityListItemSchema = IdentityRecordSchema.pick({
  oid: true,
  email: true,
  displayName: true,
  authMethod: true,
  lastSignInAt: true,
});
export type IdentityListItem = z.infer<typeof IdentityListItemSchema>;

export function listIdentities(
  options: ListOptions,
): Promise<AccessResult<Page<IdentityListItem>>> {
  return queryPage({
    schema: IdentityListItemSchema,
    options,
    index: "GSI1",
    partition: IDENTS_GSI1PK,
    sortPrefix: "IDENT#",
  });
}

const SEARCH_CAP = 10;

// ST1 D-ST2 (Access Control spec - API routes, directory `q`): case-insensitive
// substring of display name, email or UPN over the IDENTS partition, paging
// on LastEvaluatedKey (Rule 20.6) until `limit` rows (at most 10) or the end.
export async function searchIdentities(
  q: string,
  limit: number,
): Promise<IdentityListItem[]> {
  const needle = q.trim().toLowerCase();
  const cap = Math.min(limit, SEARCH_CAP);
  const found: IdentityListItem[] = [];
  if (!needle || cap <= 0) return found;
  const has = (field: string | null | undefined) =>
    field?.toLowerCase().includes(needle) ?? false;
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :sk)",
        ExpressionAttributeValues: { ":pk": IDENTS_GSI1PK, ":sk": "IDENT#" },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    for (const item of res.Items ?? []) {
      const record = IdentityRecordSchema.parse(item);
      if (has(record.displayName) || has(record.email) || has(record.upn)) {
        found.push(IdentityListItemSchema.parse(record));
        if (found.length >= cap) return found;
      }
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return found;
}

export async function identityExists(oid: string): Promise<boolean> {
  return (await getItem(identPk(oid), META_SK)) !== null;
}

export type PersonNames = { displayName: string | null; email: string | null };

// D37 (docs/specs/2026-11-10-access-control.md): the name and email of each person in an
// in-scope list, null when there is no identity item. Nothing else of the
// record is returned.
export async function personNamesOf(
  oids: readonly string[],
): Promise<Map<string, PersonNames>> {
  const unique = [...new Set(oids)];
  const found = await Promise.all(
    unique.map(async (oid) => {
      const item = await getItem(identPk(oid), META_SK);
      const identity = item
        ? IdentityListItemSchema.pick({ email: true, displayName: true }).parse(
            item,
          )
        : null;
      return [
        oid,
        {
          displayName: identity?.displayName ?? null,
          email: identity?.email ?? null,
        },
      ] as const;
    }),
  );
  return new Map(found);
}

export async function withPersonNames<T extends { oid: string }>(
  rows: readonly T[],
): Promise<(T & PersonNames)[]> {
  const names = await personNamesOf(rows.map((r) => r.oid));
  return rows.map((row) => ({
    ...row,
    displayName: names.get(row.oid)?.displayName ?? null,
    email: names.get(row.oid)?.email ?? null,
  }));
}

// The identity's own lower-cased email, for the identity link check that a
// link holds no person-kind key but that one (Access Control spec - Identity
// links, T16). Null when the record has none.
export async function ownEmail(oid: string): Promise<string | null> {
  const item = await getItem(identPk(oid), META_SK);
  if (!item) return null;
  const email = IdentityListItemSchema.shape.email.parse(item.email);
  return email ? email.trim().toLowerCase() : null;
}

export type DevIdentityMatch = {
  oid: string;
  email?: string;
  displayName?: string;
  lastSeenRoles: string[];
};

const DevIdentityMatchSchema = IdentityRecordSchema.pick({
  oid: true,
  email: true,
  displayName: true,
}).extend({ lastSeenRoles: z.array(z.string()).default([]) });

// Dev login (Access Control spec): a stored identity by oid.
export async function findIdentityByOid(
  oid: string,
): Promise<DevIdentityMatch | null> {
  const item = await getItem(identPk(oid), META_SK);
  const parsed = DevIdentityMatchSchema.safeParse(item);
  return parsed.success ? parsed.data : null;
}

// Dev login: a stored identity by lower-cased email. Walks the IDENTS
// partition to the end of its pages (Rule 20.6); dev-only, small data.
export async function findIdentityByEmail(
  email: string,
): Promise<DevIdentityMatch | null> {
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :sk)",
        ExpressionAttributeValues: { ":pk": IDENTS_GSI1PK, ":sk": "IDENT#" },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    for (const item of res.Items ?? []) {
      const parsed = DevIdentityMatchSchema.safeParse(item);
      if (parsed.success && parsed.data.email?.toLowerCase() === email) {
        return parsed.data;
      }
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return null;
}
