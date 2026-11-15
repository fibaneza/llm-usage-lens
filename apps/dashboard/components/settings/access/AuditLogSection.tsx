"use client";

import { AuditRecordSchema } from "@llm-usage-lens/shared";
import type { AuditRecord } from "@llm-usage-lens/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import {
  directoryOf,
  personName,
  useIdentityDirectory,
} from "@/components/settings/access/access-queries";
import { pageOf } from "@/components/settings/access/access-schemas";
import { FormField } from "@/components/settings/access/form-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// Source: docs/specs/2026-11-10-access-control.md - "Audit log" (actor oid or
// `system`; target omitted only on a denied attempt, which carries the refusal
// code; timestamps UTC; before/after snapshots are not displayed), "API routes
// (additions)" (GET /api/audit?day=YYYY-MM-DD, oldest first, opaque cursor),
// Rule 20.1 (UTC).
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RESULT_LABELS: Record<AuditRecord["result"], string> = {
  success: "Success",
  failed: "Failed",
  denied: "Denied",
};

const utcToday = () => new Date().toISOString().slice(0, 10);

export function AuditLogSection() {
  const [today] = useState(utcToday);
  const [day, setDay] = useState(today);
  const valid = DAY_PATTERN.test(day);
  const query = useInfiniteQuery({
    queryKey: ["access", "audit", day],
    queryFn: ({ pageParam }) =>
      fetchApi(
        `/api/audit?day=${day}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        pageOf(AuditRecordSchema),
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.cursor,
    enabled: valid,
  });
  const directory = useIdentityDirectory();
  const pages = sectionData(query);
  const names = directoryOf(directory.data);
  const records = pages?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xs">
        <FormField
          label="Day"
          hint="UTC calendar day."
          error={valid ? undefined : "Enter a day as YYYY-MM-DD"}
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          )}
        </FormField>
      </div>

      {!valid ? null : pages === undefined || directory.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : records.length === 0 ? (
        <EmptyState title={`No audit records for ${day}.`} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time (UTC)</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow
                  key={`${record.timestamp}|${record.requestId}|${record.action}|${record.target?.id ?? ""}`}
                >
                  <TableCell className="font-mono">
                    {new Date(record.timestamp).toISOString().slice(11, 19)}
                  </TableCell>
                  <TableCell>{personName(names, record.actor)}</TableCell>
                  <TableCell className="font-mono">{record.action}</TableCell>
                  <TableCell>
                    {record.target
                      ? `${record.target.type}: ${record.target.id}`
                      : "None"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge
                        variant={
                          record.result === "success"
                            ? "outline"
                            : "destructive"
                        }
                      >
                        {RESULT_LABELS[record.result]}
                      </Badge>
                      {record.code ? (
                        <span className="text-muted-foreground text-xs">
                          {record.code}
                        </span>
                      ) : null}
                      {record.category === "security" ? (
                        <Badge variant="outline">Security</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
        </>
      )}
    </div>
  );
}
