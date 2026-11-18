"use client";

import { trace } from "@opentelemetry/api";
import { useEffect } from "react";

import { NO_AWS_ACCOUNT } from "@/components/litellm/combined/source-labels";
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

import { useCreatedTeams } from "./useCreatedTeams";

const CAPTION = "Teams without an AWS account";

// M5-D3: created teams have no rollup, so their Bedrock cell is never $0 and
// they stay out of the Bedrock table, its sort, share and CSV.
export function NoAwsAccountTeams({
  department,
}: {
  department: string | null;
}) {
  const isMobile = useIsMobile();
  const created = useCreatedTeams();
  const loadError = created.error;

  useEffect(() => {
    if (loadError) trace.getActiveSpan()?.recordException(loadError);
  }, [loadError]);

  if (created.isError) {
    return (
      <p role="status" className="text-muted-foreground mt-4 text-sm">
        Teams without an AWS account could not be loaded
      </p>
    );
  }
  const teams = (created.data?.teams ?? []).filter(
    (team) => !department || team.departmentId === department,
  );
  if (teams.length === 0) return null;

  if (isMobile) {
    return (
      <ul role="list" aria-label={CAPTION} className="mt-4 space-y-3">
        {teams.map((team) => (
          <li
            key={team.teamId}
            className="bg-card rounded-card space-y-1 border p-4"
          >
            <div className="font-medium">{team.teamName}</div>
            <div className="text-muted-foreground text-xs">
              {team.departmentName ?? "—"}
            </div>
            <div className="text-muted-foreground text-sm">
              {NO_AWS_ACCOUNT}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="mt-4">
      <Table>
        <TableCaption className="mt-0 mb-2 text-left">{CAPTION}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Team</TableHead>
            <TableHead>Department</TableHead>
            <TableHead className="text-right">Bedrock</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {teams.map((team) => (
            <TableRow key={team.teamId}>
              <TableCell className="font-medium">{team.teamName}</TableCell>
              <TableCell>{team.departmentName ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground text-right">
                {NO_AWS_ACCOUNT}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
