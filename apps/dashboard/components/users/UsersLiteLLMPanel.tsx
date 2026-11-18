"use client";

import { LiteLLMUserSearchResponseSchema } from "@llm-usage-lens/shared";
import Link from "next/link";
import { useState } from "react";

import { formatUsd } from "@/components/charts/chart-data";
import { Empty, Unavailable } from "@/components/litellm/LiteLLMSection";
import { useLiteLLMQuery } from "@/components/litellm/use-litellm-query";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";

const SPEND_HEADER = "Spend (LiteLLM-reported, total to date)";
const HIDDEN = "Hidden";

// Design System -- Source panels, Cost by user (M5-D4); LD23 (the cap hides spend).
export function UsersLiteLLMPanel() {
  const [page, setPage] = useState(1);
  const isMobile = useIsMobile();
  const result = useLiteLLMQuery(
    ["users", "all", String(page)],
    `/api/litellm/users?page=${page}`,
    LiteLLMUserSearchResponseSchema,
  );

  if (result.status === "unavailable") return <Unavailable />;
  const { users, pageSize } = result.data;
  if (users.length === 0 && page === 1) {
    return (
      <>
        <Empty>No LiteLLM users</Empty>
        <PersonPointer />
      </>
    );
  }

  const capped = users.some((u) => u.spend === undefined);
  const spendText = (spend: number | undefined) =>
    spend === undefined ? HIDDEN : formatUsd(spend);

  return (
    <div className="flex flex-col gap-3">
      <PersonPointer />
      {capped ? (
        <p role="note" className="text-cell text-muted-foreground">
          Per-user spend is hidden by the Organisation cap.
        </p>
      ) : null}
      {isMobile ? (
        <ul aria-label="LiteLLM users" className="flex flex-col gap-2">
          {users.map((u) => (
            <li
              key={u.userId}
              className="rounded-card border-border flex flex-col gap-1 border p-3"
            >
              <span className="text-sm font-medium">{u.email}</span>
              <span className="text-cell text-muted-foreground">
                {u.teams.map((t) => t.teamName).join(", ") || "No teams"}
              </span>
              <span className="text-cell">
                {SPEND_HEADER}: {spendText(u.spend)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Table>
          <TableCaption className="sr-only">LiteLLM users</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Teams</TableHead>
              <TableHead className="text-right">{SPEND_HEADER}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.userId}>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  {u.teams.map((t) => t.teamName).join(", ") || "No teams"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {spendText(u.spend)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <span className="text-cell text-muted-foreground">Page {page}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={users.length < pageSize}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function PersonPointer() {
  return (
    <p className="text-cell text-muted-foreground max-w-[72ch]">
      The range figure for one person is under{" "}
      <Link
        href="/dashboard/manage/litellm/users"
        prefetch={false}
        className="text-link underline underline-offset-4"
      >
        Management → LiteLLM → LiteLLM users
      </Link>
      .
    </p>
  );
}
