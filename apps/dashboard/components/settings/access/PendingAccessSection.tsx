"use client";

import {
  PendingItemSchema,
  StaleAccessRowSchema,
} from "@llm-usage-lens/shared";
import type {
  OrgUnits,
  PendingItem,
  StaleAccessRow,
} from "@llm-usage-lens/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { z } from "zod";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { EmptyState } from "@/components/display/EmptyState";
import { useOrgUnits } from "@/components/settings/access/access-queries";
import { pageOf } from "@/components/settings/access/access-schemas";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi } from "@/lib/query/fetch-api";
import { sectionData } from "@/lib/query/section-data";

// Source: docs/specs/2026-11-10-access-control.md - "Membership, admin scopes
// and lifecycle" (Joiner: a pending item grants nothing until the first
// sign-in binds it; Leaver: stale = pending items not bound after 30 days, and
// affiliations, admin scopes and in-app grants whose user has not signed in for
// 90 days, D2), D34 (user, 2026-11-15), D37 (names for in-scope rows only),
// Rule 20.1 (UTC dates). Read-only: removal goes through the Members and Team
// admins sections. The routes scope the rows.
const utcDay = (iso: string) => iso.slice(0, 10);

type Names = {
  teams: ReadonlyMap<string, string>;
  departments: ReadonlyMap<string, string>;
};

function namesOf(units: OrgUnits | undefined): Names {
  return {
    teams: new Map((units?.teams ?? []).map((t) => [t.id, t.name])),
    departments: new Map((units?.departments ?? []).map((d) => [d.id, d.name])),
  };
}

function placeText(
  row: {
    teamId?: string | undefined;
    scopeType?: "team" | "department" | undefined;
    scopeId?: string | undefined;
  },
  names: Names,
): string {
  if (row.teamId !== undefined) {
    return names.teams.get(row.teamId) ?? row.teamId;
  }
  if (row.scopeId === undefined) return "";
  return row.scopeType === "department"
    ? (names.departments.get(row.scopeId) ?? row.scopeId)
    : (names.teams.get(row.scopeId) ?? row.scopeId);
}

function pendingGets(item: PendingItem, names: Names): string {
  if (item.kind === "affiliation") {
    return `Member of ${placeText(item, names)}`;
  }
  return `${item.scopeType === "department" ? "Department" : "Team"} admin of ${placeText(item, names)}`;
}

function staleGets(row: StaleAccessRow, names: Names): string {
  if (row.kind === "roleGrant") return `Role ${row.role ?? ""}`.trim();
  if (row.kind === "affiliation") return `Member of ${placeText(row, names)}`;
  return `${row.scopeType === "department" ? "Department" : "Team"} admin of ${placeText(row, names)}`;
}

function List<S extends z.ZodType>({
  queryKey,
  path,
  item,
  emptyTitle,
  renderTable,
}: {
  queryKey: string;
  path: string;
  item: S;
  emptyTitle: string;
  renderTable: (rows: z.output<S>[]) => ReactNode;
}) {
  const query = useInfiniteQuery({
    queryKey: ["access", queryKey],
    queryFn: ({ pageParam }) =>
      fetchApi(
        pageParam ? `${path}?cursor=${encodeURIComponent(pageParam)}` : path,
        pageOf(item),
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.cursor,
  });
  const pages = sectionData(query);
  if (pages === undefined) return <Skeleton className="h-24 w-full" />;
  const rows = pages.pages.flatMap((p) => p.items) as z.output<S>[];
  if (rows.length === 0) return <EmptyState title={emptyTitle} />;
  return (
    <div className="flex flex-col gap-3">
      {renderTable(rows)}
      {query.hasNextPage ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PendingAccessSection() {
  // The names are a nicety: while they load, or if they fail, ids show.
  const names = namesOf(useOrgUnits().data);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Pending invitations</h3>
        <SectionBoundary
          title="the pending invitations"
          fallback={<Skeleton className="h-24 w-full" />}
        >
          <List
            queryKey="pending"
            path="/api/access/pending"
            item={PendingItemSchema}
            emptyTitle="No pending invitations."
            renderTable={(rows: PendingItem[]) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email or UPN</TableHead>
                    <TableHead>Will get</TableHead>
                    <TableHead>Invited (UTC)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={`${row.emailOrUpn}|${row.kind}|${row.kind === "affiliation" ? row.teamId : `${row.scopeType}:${row.scopeId}`}`}
                    >
                      <TableCell>{row.emailOrUpn}</TableCell>
                      <TableCell>{pendingGets(row, names)}</TableCell>
                      <TableCell className="font-mono">
                        {utcDay(row.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          />
        </SectionBoundary>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Stale access</h3>
        <SectionBoundary
          title="the stale access"
          fallback={<Skeleton className="h-24 w-full" />}
        >
          <List
            queryKey="stale"
            path="/api/access/stale"
            item={StaleAccessRowSchema}
            emptyTitle="No stale access."
            renderTable={(rows: StaleAccessRow[]) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Why it is stale</TableHead>
                    <TableHead>Since (UTC)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={`${row.reason}|${row.subject}|${row.kind}|${row.teamId ?? ""}|${row.scopeType ?? ""}:${row.scopeId ?? ""}|${row.role ?? ""}`}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span>
                            {row.displayName ?? row.email ?? row.subject}
                          </span>
                          {row.displayName && row.email ? (
                            <span className="text-muted-foreground text-xs">
                              {row.email}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>{staleGets(row, names)}</TableCell>
                      <TableCell>
                        {row.reason === "pending"
                          ? "Invitation not bound after 30 days"
                          : "No sign-in for 90 days"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {utcDay(row.since)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          />
        </SectionBoundary>
      </div>
    </div>
  );
}
