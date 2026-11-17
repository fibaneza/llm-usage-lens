"use client";

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
import { useLiteLLMQuery, useUrlRange } from "./use-litellm-query";

// LiteLLM's own audit entries: field names only, never values (LiteLLM spec --
// Audit). "via dashboard" marks entries the dashboard made.
export function AuditSection() {
  const { keyParts, query } = useUrlRange();
  const result = useLiteLLMQuery(
    ["audit", ...keyParts],
    `/api/litellm/audit?${query}`,
    LiteLLMAuditResponseSchema,
  );
  if (result.status === "unavailable") return <Unavailable />;
  const { items } = result.data;
  if (items.length === 0) return <Empty>No audit entries.</Empty>;
  return (
    <Table>
      <TableCaption className="sr-only">LiteLLM audit entries</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
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
  );
}
