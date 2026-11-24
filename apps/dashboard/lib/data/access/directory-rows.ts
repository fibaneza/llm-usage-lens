import "server-only";

import type { DirectoryDir, DirectorySort } from "@llm-usage-lens/shared";

import { getAffiliation } from "./affiliations";
import { decodeCursor, encodeCursor } from "./cursor";
import { listIdentitiesBounded } from "./identities";
import type { IdentityListItem } from "./identities";
import type { AccessResult } from "./result";

// Source: docs/specs/2026-11-10-access-control.md - row
// /api/identities/directory, "From 2026-11-24 (unit US1, D-US3, D-US3a)":
// at most 2,000 identities sorted in memory, stable tie-break on oid, a row
// without the sort value last in both directions, the cursor encodes sort and
// direction (HMAC-protected, like every list cursor). Nothing is cached.
const AFFILIATION_BATCH = 20;

export type DirectoryListing = {
  items: IdentityListItem[];
  cursor?: string;
  truncated: boolean;
};

type Sortable = { item: IdentityListItem; value: string | null };

function valueOf(
  item: IdentityListItem,
  sort: DirectorySort,
  team: string | null,
): string | null {
  switch (sort) {
    case "name":
      return item.displayName?.toLowerCase() || null;
    case "email":
      return item.email?.toLowerCase() || null;
    case "createdAt":
      return item.createdAt ?? null;
    case "lastSignInAt":
      return item.lastSignInAt ?? null;
    case "team":
      return team?.toLowerCase() || null;
  }
}

async function teamLabels(
  items: readonly IdentityListItem[],
  teamNames: ReadonlyMap<string, string>,
): Promise<Map<string, string | null>> {
  const labels = new Map<string, string | null>();
  for (let i = 0; i < items.length; i += AFFILIATION_BATCH) {
    await Promise.all(
      items.slice(i, i + AFFILIATION_BATCH).map(async (item) => {
        const teamId = (await getAffiliation(item.oid))?.teamId;
        labels.set(item.oid, teamId ? (teamNames.get(teamId) ?? teamId) : null);
      }),
    );
  }
  return labels;
}

export async function listDirectory(options: {
  sort: DirectorySort;
  dir: DirectoryDir;
  cursor?: string;
  cursorSecret: string;
  limit: number;
  teamNames: ReadonlyMap<string, string>;
  bound?: number;
}): Promise<AccessResult<DirectoryListing>> {
  const { sort, dir, cursorSecret, limit } = options;
  let offset = 0;
  if (options.cursor !== undefined) {
    const decoded = decodeCursor(options.cursor, cursorSecret);
    const start = decoded.ok ? Number(decoded.value.offset) : NaN;
    if (
      !decoded.ok ||
      decoded.value.sort !== sort ||
      decoded.value.dir !== dir ||
      !Number.isInteger(start) ||
      start < 0
    ) {
      return { ok: false, code: "BAD_CURSOR" };
    }
    offset = start;
  }

  const { items, truncated } = await listIdentitiesBounded(
    options.bound === undefined ? {} : { bound: options.bound },
  );
  const labels =
    sort === "team" ? await teamLabels(items, options.teamNames) : null;
  const rows: Sortable[] = items.map((item) => ({
    item,
    value: valueOf(item, sort, labels?.get(item.oid) ?? null),
  }));
  const sign = dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    if (a.value === null || b.value === null) {
      if (a.value === b.value) return a.item.oid < b.item.oid ? -1 : 1;
      return a.value === null ? 1 : -1;
    }
    if (a.value !== b.value) return a.value < b.value ? -sign : sign;
    return a.item.oid < b.item.oid ? -1 : a.item.oid > b.item.oid ? 1 : 0;
  });

  const page = rows.slice(offset, offset + limit).map((r) => r.item);
  const next = offset + limit;
  return {
    ok: true,
    value: {
      items: page,
      truncated,
      ...(next < rows.length
        ? {
            cursor: encodeCursor(
              { sort, dir, offset: String(next) },
              cursorSecret,
            ),
          }
        : {}),
    },
  };
}
