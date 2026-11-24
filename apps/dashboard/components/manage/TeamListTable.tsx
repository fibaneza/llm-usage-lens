"use client";

import { useQueryStates } from "nuqs";
import Link from "next/link";

import { TeamCreateTrigger } from "@/components/manage/TeamCreateTrigger";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  SORT_PARAMS,
  SortableHeader,
  readSort,
} from "@/components/tables/SortableHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TeamListRow } from "@/lib/manage/team-list";

const COLUMNS = ["team", "department", "members", "litellm"] as const;

const DESCRIPTION =
  "The teams you may open, with their members and LiteLLM team.";

// The Team list (Design System - Management pages, "List, then the team", unit
// TM1; D-TM1, D-TM4). The page filters the rows by scope and, for a caller who
// is not a global reader, withholds the LiteLLM team id; New team stays here.
export function TeamListTable({
  rows,
  canCreateTeam,
  scopeLabel,
}: {
  rows: readonly TeamListRow[];
  canCreateTeam: boolean;
  scopeLabel?: string | null;
}) {
  const [params] = useQueryStates(SORT_PARAMS);
  // A lead's rows carry no LiteLLM team id, so that column is not offered.
  const showLiteLLMSort = rows.some((r) => r.litellmTeamId !== null);
  const sortKeys: readonly string[] = showLiteLLMSort
    ? COLUMNS
    : COLUMNS.filter((c) => c !== "litellm");
  const { key, dir } = readSort(params.sort, params.dir, "team", sortKeys);
  const sign = dir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    if (key === "members") return sign * (a.memberCount - b.memberCount);
    const [x, y] =
      key === "department"
        ? [a.departmentName, b.departmentName]
        : key === "litellm"
          ? [a.litellmTeamId ?? "", b.litellmTeamId ?? ""]
          : [a.teamName, b.teamName];
    return sign * x.localeCompare(y);
  });
  const createTrigger = canCreateTeam ? <TeamCreateTrigger /> : undefined;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        description={DESCRIPTION}
        actions={createTrigger}
        scopeLine={
          scopeLabel
            ? { label: scopeLabel, names: rows.map((r) => r.teamName) }
            : undefined
        }
      />
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No teams to show.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader
                sortKey="team"
                sortKeys={sortKeys}
                defaultKey="team"
              >
                Team
              </SortableHeader>
              <SortableHeader
                sortKey="department"
                sortKeys={sortKeys}
                defaultKey="team"
              >
                Department
              </SortableHeader>
              <SortableHeader
                sortKey="members"
                sortKeys={sortKeys}
                defaultKey="team"
                className="text-right"
              >
                Members
              </SortableHeader>
              {showLiteLLMSort ? (
                <SortableHeader
                  sortKey="litellm"
                  sortKeys={sortKeys}
                  defaultKey="team"
                >
                  LiteLLM team
                </SortableHeader>
              ) : (
                <TableHead>LiteLLM team</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow key={row.teamId}>
                <TableCell>
                  <Link
                    href={`/dashboard/manage/team/${encodeURIComponent(row.teamId)}`}
                    className="text-primary font-medium underline-offset-4 hover:underline"
                  >
                    {row.teamName}
                  </Link>
                </TableCell>
                <TableCell>{row.departmentName}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {row.memberCount}
                </TableCell>
                <TableCell
                  className={
                    row.litellmLinked ? undefined : "text-muted-foreground"
                  }
                >
                  {row.litellmTeamId ??
                    (row.litellmLinked ? "Linked" : "Not linked")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
