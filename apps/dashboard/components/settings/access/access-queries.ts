import { OrgUnitsSchema } from "@llm-usage-lens/shared";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";

import {
  IdentityItemSchema,
  pageOf,
  type IdentityItem,
} from "@/components/settings/access/access-schemas";
import { fetchApi } from "@/lib/query/fetch-api";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)".
const MAX_PAGES = 50;

export async function fetchAllPages<S extends z.ZodType>(
  path: string,
  item: S,
): Promise<z.output<S>[]> {
  const items: z.output<S>[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < MAX_PAGES; n += 1) {
    const url = cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
    const page = await fetchApi(url, pageOf(item));
    items.push(...(page.items as z.output<S>[]));
    cursor = page.cursor;
    if (cursor === undefined) return items;
  }
  throw new Error(`Too many pages from ${path}`);
}

export const idPath = encodeURIComponent;

// The scoped organisation lists the pickers share (F10): the account registry,
// already limited by the server to the teams and departments the caller manages
// (Access Control spec - "Permission matrix").
export function useOrgUnits() {
  return useQuery({
    queryKey: ["access", "org-units"],
    queryFn: () => fetchApi("/api/access/org-units", OrgUnitsSchema),
  });
}

// The people directory is internal-admin / internal-auditor only, so a caller
// without it (403) is a handled state: rows fall back to the oid. The error is
// deliberately not thrown into the section boundary.
export function useIdentityDirectory() {
  return useQuery({
    queryKey: ["access", "identities"],
    queryFn: () => fetchAllPages("/api/identities", IdentityItemSchema),
    retry: false,
  });
}

export type Directory = ReadonlyMap<string, IdentityItem>;

export function directoryOf(items: readonly IdentityItem[] | undefined) {
  return new Map((items ?? []).map((i) => [i.oid, i] as const));
}

export function personName(directory: Directory, oid: string): string {
  const found = directory.get(oid);
  return found?.displayName ?? found?.email ?? oid;
}

export function personLabel(identity: IdentityItem): string {
  const name = identity.displayName ?? identity.email ?? identity.oid;
  return identity.email && identity.displayName
    ? `${name} (${identity.email})`
    : name;
}

// F11: member and admin rows carry their own name, so a scoped admin who cannot
// read the directory still sees people; the oid is the last resort.
export function rowName(row: {
  oid: string;
  displayName: string | null;
  email: string | null;
}): string {
  return row.displayName ?? row.email ?? row.oid;
}
