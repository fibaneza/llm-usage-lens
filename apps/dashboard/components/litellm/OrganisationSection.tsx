"use client";

import { CircleDollarSign } from "lucide-react";
import Link from "next/link";

import { formatUsd } from "@/components/charts/chart-data";
import { MetricCard } from "@/components/display/MetricCard";
import { coverageText } from "@/components/manage/MemberSumDetail";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LiteLLMOrgResponseSchema } from "@llm-usage-lens/shared";

import { DailySpend } from "./DailySpend";
import { Empty, Unavailable } from "./LiteLLMSection";
import { useLiteLLMQuery, useUrlRange } from "./use-litellm-query";

const NUMERIC = "text-right font-mono tabular-nums";
const SOURCE_LABEL = {
  "litellm-team": "LiteLLM team",
  "member-sum": "Sum of members",
} as const;

// Organisation tab (LiteLLM spec -- Views by role; App Teams spec --
// Organisation view): the headline total is the LiteLLM teams' total (AT5),
// then two tables whose rows do not add up to each other. LiteLLM-reported
// figures (LT8).
export function OrganisationSection() {
  const { keyParts, query } = useUrlRange();
  const result = useLiteLLMQuery(
    ["org", ...keyParts],
    `/api/litellm/org?${query}`,
    LiteLLMOrgResponseSchema,
  );
  if (result.status === "unavailable") return <Unavailable />;
  const { configured, totals, daily, litellmTeams, appTeams } = result.data;
  if (litellmTeams.length === 0 && appTeams.length === 0) {
    return <Empty>No teams</Empty>;
  }
  return (
    <div className="flex flex-col gap-4">
      {configured ? (
        <>
          <MetricCard
            title="Total spend"
            value={formatUsd(totals.spend)}
            icon={CircleDollarSign}
          />
          <DailySpend daily={daily} />
        </>
      ) : null}
      {configured ? (
        <Table>
          <TableCaption className="mt-0 mb-2 text-left">
            LiteLLM teams
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Alias</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead>App team</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {litellmTeams.map((team) => (
              <TableRow key={team.litellmTeamId}>
                <TableCell>{team.alias ?? team.litellmTeamId}</TableCell>
                <TableCell className={NUMERIC}>
                  {formatUsd(team.spend)}
                </TableCell>
                <TableCell className={NUMERIC}>
                  {team.maxBudget === null
                    ? "No limit"
                    : formatUsd(team.maxBudget)}
                </TableCell>
                <TableCell className={NUMERIC}>{team.memberCount}</TableCell>
                <TableCell>
                  {team.linkedAppTeam
                    ? team.linkedAppTeam.teamName
                    : "unlinked"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Empty>LiteLLM not configured</Empty>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-cell text-muted-foreground">
          Per app team. Rows overlap with each other and do not add up to the
          total.
        </p>
        <Table>
          <TableCaption className="mt-0 mb-2 text-left">App teams</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Spend source</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead>Coverage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appTeams.map((team) => (
              <TableRow key={team.teamId}>
                <TableCell>{team.teamName}</TableCell>
                <TableCell>{SOURCE_LABEL[team.spendSource]}</TableCell>
                <TableCell className={NUMERIC}>
                  {team.spend === null && !configured ? (
                    "Not available"
                  ) : team.spend === null ? (
                    <Link
                      className="text-link underline-offset-4 hover:underline"
                      href={`/dashboard/manage/team?team=${encodeURIComponent(team.teamId)}`}
                    >
                      Open the team page
                    </Link>
                  ) : (
                    formatUsd(team.spend)
                  )}
                </TableCell>
                <TableCell>
                  {team.coverage ? coverageText(team.coverage) : "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
