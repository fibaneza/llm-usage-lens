"use client";

import { CircleDollarSign } from "lucide-react";

import { formatUsd } from "@/components/charts/chart-data";
import { MetricCard } from "@/components/display/MetricCard";
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

// Organisation tab (LiteLLM spec -- Views by role): totals across every
// linked team and a per-team table. LiteLLM-reported figures (LT8).
export function OrganisationSection() {
  const { keyParts, query } = useUrlRange();
  const result = useLiteLLMQuery(
    ["org", ...keyParts],
    `/api/litellm/org?${query}`,
    LiteLLMOrgResponseSchema,
  );
  if (result.status === "unavailable") return <Unavailable />;
  const { totals, daily, teams } = result.data;
  if (teams.length === 0) return <Empty>No linked teams</Empty>;
  return (
    <div className="flex flex-col gap-4">
      <MetricCard
        title="Total spend"
        value={formatUsd(totals.spend)}
        icon={CircleDollarSign}
      />
      <DailySpend daily={daily} />
      <Table>
        <TableCaption className="mt-0 mb-2 text-left">
          Spend by linked team
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Budget</TableHead>
            <TableHead className="text-right">Members</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {teams.map((team) => (
            <TableRow key={team.teamId}>
              <TableCell>{team.teamName}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatUsd(team.spend)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {team.maxBudget === null
                  ? "No limit"
                  : formatUsd(team.maxBudget)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {team.memberCount}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
