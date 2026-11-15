import "server-only";

import { IdentityRecordSchema } from "@llm-usage-lens/shared";
import type { z } from "zod";

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
