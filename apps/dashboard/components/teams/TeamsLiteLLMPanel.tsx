"use client";

import { LiteLLMOrgResponseSchema } from "@llm-usage-lens/shared";
import { DollarSign } from "lucide-react";
import type { z } from "zod";

import { formatUsd } from "@/components/charts/chart-data";
import { MetricCard } from "@/components/display/MetricCard";
import {
  LITELLM_NOT_CONFIGURED,
  NOT_IN_LITELLM,
} from "@/components/litellm/combined/source-labels";
import type { CombinedRange } from "@/components/litellm/combined/use-combined-query";
import { Unavailable } from "@/components/litellm/LiteLLMSection";
import { useLiteLLMQuery } from "@/components/litellm/use-litellm-query";
import { coverageText } from "@/components/manage/MemberSumDetail";
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
import { useIsMobile } from "@/hooks/use-mobile";

import { TeamSumOfMembers } from "./TeamSumOfMembers";

type AppTeam = z.output<typeof LiteLLMOrgResponseSchema>["appTeams"][number];

const CAPTION = "App teams (LiteLLM)";

function spendText(team: AppTeam): string {
  if (
    team.spendSource === "member-sum" &&
    team.coverage &&
    team.coverage.members > 0 &&
    team.coverage.matched === 0
  ) {
    return NOT_IN_LITELLM;
  }
  if (team.spend !== null) return formatUsd(team.spend);
  if (team.reason === "open-team") return "Open team";
  return "Not available";
}

const sourceText = (team: AppTeam) =>
  team.spendSource === "litellm-team" ? "LiteLLM team" : "Sum of members";

function SumOfMembers({
  team,
  range,
}: {
  team: AppTeam;
  range: CombinedRange;
}) {
  const linked = team.spendSource === "litellm-team";
  if (!linked && team.reason !== "open-team") return null;
  return (
    <TeamSumOfMembers
      teamId={team.teamId}
      teamName={team.teamName}
      range={range}
      linked={linked}
    />
  );
}

function TeamsTable({
  teams,
  range,
}: {
  teams: readonly AppTeam[];
  range: CombinedRange;
}) {
  return (
    <Table>
      <TableCaption className="mt-0 mb-2 text-left">{CAPTION}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Team</TableHead>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">Spend</TableHead>
          <TableHead>Coverage</TableHead>
          <TableHead>Sum of members</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {teams.map((team) => (
          <TableRow key={team.teamId}>
            <TableCell className="font-medium">{team.teamName}</TableCell>
            <TableCell>
              <Badge variant="outline">{sourceText(team)}</Badge>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {spendText(team)}
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {team.coverage ? coverageText(team.coverage) : null}
            </TableCell>
            <TableCell>
              <SumOfMembers team={team} range={range} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TeamsCards({
  teams,
  range,
}: {
  teams: readonly AppTeam[];
  range: CombinedRange;
}) {
  return (
    <ul role="list" aria-label={CAPTION} className="space-y-3">
      {teams.map((team) => (
        <li
          key={team.teamId}
          className="bg-card rounded-card space-y-2 border p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 font-medium break-words">
              {team.teamName}
            </span>
            <span className="shrink-0 font-mono font-semibold tabular-nums">
              <span className="sr-only">Spend </span>
              {spendText(team)}
            </span>
          </div>
          <Badge variant="outline">{sourceText(team)}</Badge>
          {team.coverage ? (
            <p className="text-muted-foreground text-xs">
              {coverageText(team.coverage)}
            </p>
          ) : null}
          <SumOfMembers team={team} range={range} />
        </li>
      ))}
    </ul>
  );
}

// Design System -- Source panels, Cost by team: the LiteLLM teams total
// (LD33), then the app-team table. Reads happen in the browser only.
export function TeamsLiteLLMPanel({ range }: { range: CombinedRange }) {
  const isMobile = useIsMobile();
  const result = useLiteLLMQuery(
    ["org", range.dateFrom, range.dateTo],
    `/api/litellm/org?dateFrom=${range.dateFrom}&dateTo=${range.dateTo}`,
    LiteLLMOrgResponseSchema,
  );
  if (result.status === "unavailable") return <Unavailable />;
  const org = result.data;
  if (!org.configured) {
    return (
      <p className="text-muted-foreground text-sm">{LITELLM_NOT_CONFIGURED}</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <MetricCard
        title="LiteLLM teams total"
        value={formatUsd(org.totals.spend)}
        icon={DollarSign}
      />
      <p className="text-muted-foreground text-sm">
        Per app team. Rows overlap and do not add up to the total.
      </p>
      {org.appTeams.length === 0 ? (
        <p className="text-muted-foreground text-sm">No app teams</p>
      ) : isMobile ? (
        <TeamsCards teams={org.appTeams} range={range} />
      ) : (
        <TeamsTable teams={org.appTeams} range={range} />
      )}
    </div>
  );
}
