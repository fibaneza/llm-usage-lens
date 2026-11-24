"use client";

import { useQueryStates } from "nuqs";

import {
  SORT_PARAMS,
  SortableHeader,
  readSort,
} from "@/components/tables/SortableHeader";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Empty, Unavailable } from "./LiteLLMSection";
import { LiteLLMAuditResponseSchema } from "@llm-usage-lens/shared";
import { formatSydneyTime } from "./sydney-time";
import { useLiteLLMEditionQuery, useUrlRange } from "./use-litellm-query";

const SORT_KEYS = ["time"] as const;

// Design System - "Sorting in the other tables (unit SRT1; D-SR1)": time sorts
// on the server, newest first by default.
// LiteLLM's own audit entries: field names only, never values (LiteLLM spec --
// Audit). "via dashboard" marks entries the dashboard made.
export function AuditSection() {
  const isMobile = useIsMobile();
  const { keyParts, query } = useUrlRange();
  const [params] = useQueryStates(SORT_PARAMS);
  const { dir } = readSort(params.sort, params.dir, "time", SORT_KEYS, "desc");
  const result = useLiteLLMEditionQuery(
    ["audit", ...keyParts, dir],
    `/api/litellm/audit?${query}&dir=${dir}`,
    LiteLLMAuditResponseSchema,
  );
  if (result.status === "unavailable") return <Unavailable />;
  if (result.status === "needs-enterprise") {
    return <Empty>The LiteLLM audit log needs LiteLLM Enterprise</Empty>;
  }
  const { items } = result.data;
  if (items.length === 0) return <Empty>No audit entries.</Empty>;
  return (
    <>
      {isMobile ? (
        <ul
          role="list"
          aria-label="LiteLLM audit entries"
          className="space-y-3"
        >
          {items.map((entry) => (
            <li
              key={entry.id}
              className="bg-card text-card-foreground rounded-card space-y-3 border p-4"
            >
              <div className="min-w-0 font-medium break-words">
                {formatSydneyTime(entry.updatedAt)}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Actor</dt>
                  <dd className="flex flex-wrap items-center gap-2 break-words">
                    {entry.changedBy}
                    {entry.viaDashboard ? (
                      <Badge variant="outline">via dashboard</Badge>
                    ) : null}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Action</dt>
                  <dd className="break-words">{entry.action}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Object</dt>
                  <dd className="break-words">
                    <span className="text-muted-foreground block text-xs">
                      {entry.tableName}
                    </span>
                    {entry.objectId}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">
                    Changed fields
                  </dt>
                  <dd className="flex flex-wrap gap-1">
                    {entry.changedFields.map((field) => (
                      <Badge key={field} variant="outline">
                        {field}
                      </Badge>
                    ))}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <Table>
            <TableCaption className="sr-only">
              LiteLLM audit entries
            </TableCaption>
            <TableHeader>
              <TableRow>
                <SortableHeader
                  sortKey="time"
                  sortKeys={SORT_KEYS}
                  defaultKey="time"
                  defaultDir="desc"
                >
                  Time
                </SortableHeader>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Object</TableHead>
                <TableHead>Changed fields</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatSydneyTime(entry.updatedAt)}</TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="flex flex-wrap items-center gap-2">
                      {entry.changedBy}
                      {entry.viaDashboard ? (
                        <Badge variant="outline">via dashboard</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>{entry.action}</TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="text-muted-foreground block text-xs">
                      {entry.tableName}
                    </span>
                    {entry.objectId}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="flex flex-wrap gap-1">
                      {entry.changedFields.map((field) => (
                        <Badge key={field} variant="outline">
                          {field}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
