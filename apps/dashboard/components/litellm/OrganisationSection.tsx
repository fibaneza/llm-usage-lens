"use client";

import { CircleDollarSign } from "lucide-react";
import Link from "next/link";

import { OrgResetCell } from "@/components/budget-resets/BudgetResetCount";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { TEAM_USAGE_HREF } from "@/lib/nav";
import { LiteLLMOrgResponseSchema } from "@llm-usage-lens/shared";

import { DailySpend } from "./DailySpend";
import { Empty, Unavailable } from "./LiteLLMSection";
import { useLiteLLMQuery, useUrlRange } from "./use-litellm-query";

const NUMERIC = "text-right font-mono tabular-nums";
const SOURCE_LABEL = {
  "litellm-team": "LiteLLM team",
  "member-sum": "Sum of members",
} as const;

type OrgData = ReturnType<typeof LiteLLMOrgResponseSchema.parse>;

const teamPageHref = (teamId: string) =>
  `/dashboard/manage/team?team=${encodeURIComponent(teamId)}`;

function AppTeamName({ team }: { team: OrgData["appTeams"][number] }) {
  return (
    <Link
      className="text-link underline-offset-4 hover:underline"
      href={teamPageHref(team.teamId)}
    >
      {team.teamName}
    </Link>
  );
}

function AppTeamSpend({
  team,
  configured,
}: {
  team: OrgData["appTeams"][number];
  configured: boolean;
}) {
  if (team.spend !== null) return <>{formatUsd(team.spend)}</>;
  if (!configured) return <>Not available</>;
  return (
    <Link
      className="text-link underline-offset-4 hover:underline"
      href={`${TEAM_USAGE_HREF}?team=${encodeURIComponent(team.teamId)}`}
    >
      Open the team page
    </Link>
  );
}

// Organisation tab (LiteLLM spec -- Views by role; App Teams spec --
// Organisation view): the headline total is the LiteLLM teams' total (AT5),
// then two tables whose rows do not add up to each other. LiteLLM-reported
// figures (LT8).
export function OrganisationSection() {
  const isMobile = useIsMobile();
  const { keyParts, query } = useUrlRange();
  const range = { dateFrom: keyParts[0], dateTo: keyParts[1] };
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
      {!configured ? (
        <Empty>LiteLLM not configured</Empty>
      ) : isMobile ? (
        <ul role="list" aria-label="LiteLLM teams" className="space-y-3">
          {litellmTeams.map((team) => (
            <li
              key={team.litellmTeamId}
              className="bg-card text-card-foreground rounded-card space-y-3 border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 font-medium break-words">
                  {team.alias ?? team.litellmTeamId}
                </div>
                <div className="shrink-0 text-base font-semibold">
                  <span className="sr-only">Spend</span>
                  <span className="font-mono tabular-nums">
                    {formatUsd(team.spend)}
                  </span>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Budget</dt>
                  <dd className="font-mono tabular-nums">
                    {team.maxBudget === null
                      ? "No limit"
                      : formatUsd(team.maxBudget)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Members</dt>
                  <dd className="font-mono tabular-nums">{team.memberCount}</dd>
                </div>
                <div className="col-span-2 min-w-0">
                  <dt className="text-muted-foreground text-xs">App team</dt>
                  <dd>
                    {team.linkedAppTeam
                      ? team.linkedAppTeam.teamName
                      : "unlinked"}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : (
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
      )}
      <div className="flex flex-col gap-1">
        <p className="text-cell text-muted-foreground">
          Per app team. Rows overlap with each other and do not add up to the
          total.
        </p>
        {isMobile ? (
          <ul role="list" aria-label="App teams" className="space-y-3">
            {appTeams.map((team) => (
              <li
                key={team.teamId}
                className="bg-card text-card-foreground rounded-card space-y-3 border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 font-medium break-words">
                    <AppTeamName team={team} />
                  </div>
                  <div className="shrink-0 text-base font-semibold">
                    <span className="sr-only">Spend</span>
                    <span className="font-mono tabular-nums">
                      <AppTeamSpend team={team} configured={configured} />
                    </span>
                  </div>
                </div>
                <dl className="grid grid-cols-1 gap-y-2 text-sm">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">
                      Spend source
                    </dt>
                    <dd>{SOURCE_LABEL[team.spendSource]}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Coverage</dt>
                    <dd>{team.coverage ? coverageText(team.coverage) : "-"}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">
                      Budget resets
                    </dt>
                    <dd>
                      <OrgResetCell teamId={team.teamId} range={range} />
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <Table>
            <TableCaption className="mt-0 mb-2 text-left">
              App teams
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Spend source</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead>Coverage</TableHead>
                <TableHead>Budget resets</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appTeams.map((team) => (
                <TableRow key={team.teamId}>
                  <TableCell>
                    <AppTeamName team={team} />
                  </TableCell>
                  <TableCell>{SOURCE_LABEL[team.spendSource]}</TableCell>
                  <TableCell className={NUMERIC}>
                    <AppTeamSpend team={team} configured={configured} />
                  </TableCell>
                  <TableCell>
                    {team.coverage ? coverageText(team.coverage) : "-"}
                  </TableCell>
                  <TableCell>
                    <OrgResetCell teamId={team.teamId} range={range} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
