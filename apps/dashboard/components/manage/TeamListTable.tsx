import Link from "next/link";

import { TeamCreateTrigger } from "@/components/manage/TeamCreateTrigger";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TeamListRow } from "@/lib/manage/team-list";

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
              <TableHead>Team</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead>LiteLLM team</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
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
