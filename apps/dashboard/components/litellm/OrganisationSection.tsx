"use client";

import Link from "next/link";

import { formatUsd } from "@/components/charts/chart-data";
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
import { cn } from "@/lib/utils";
import { LiteLLMOrgResponseSchema } from "@llm-usage-lens/shared";

import { Empty, Unavailable } from "./LiteLLMSection";
import { OrgSpendPanel } from "./organisation/OrgSpendPanel";
import { formatCount } from "./organisation/format";
import { OrgUsageTiles } from "./organisation/OrgUsageTiles";
import { useLiteLLMQuery, useUrlRange } from "./use-litellm-query";

const NUMERIC = "text-right font-mono tabular-nums";

type OrgData = ReturnType<typeof LiteLLMOrgResponseSchema.parse>;

const teamPageHref = (teamId: string) =>
  `/dashboard/manage/team/${encodeURIComponent(teamId)}`;
const litellmTeamHref = (litellmTeamId: string) =>
  `/dashboard/manage/litellm/teams/${encodeURIComponent(litellmTeamId)}`;
const LINK = "text-link underline-offset-4 hover:underline";

type OrgTeam = OrgData["litellmTeams"][number];

function TeamName({ team }: { team: OrgTeam }) {
  return (
    <Link className={LINK} href={litellmTeamHref(team.litellmTeamId)}>
      {team.alias ?? team.litellmTeamId}
    </Link>
  );
}

const ABSENT = "—";
const HIDE_BELOW_LG = "hidden lg:table-cell";

// Team spend / total spend, one decimal; "—" when nothing was spent (T-OC12).
const shareOf = (spend: number, total: number): number | null =>
  total > 0 ? (spend / total) * 100 : null;

const countOf = (value: number | undefined) =>
  value === undefined ? ABSENT : formatCount(value);

function ShareValue({ share, bar }: { share: number | null; bar: boolean }) {
  if (share === null) return <>{ABSENT}</>;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {bar ? (
        <span
          aria-hidden="true"
          className="bg-muted inline-block h-1.5 w-16 overflow-hidden rounded-full"
        >
          <span
            className="bg-primary block h-full"
            style={{ width: `${Math.min(share, 100)}%` }}
          />
        </span>
      ) : null}
      <span>{`${share.toFixed(1)}%`}</span>
    </span>
  );
}

function AppTeam({ team }: { team: OrgTeam }) {
  return team.linkedAppTeam ? (
    <Link className={LINK} href={teamPageHref(team.linkedAppTeam.teamId)}>
      {team.linkedAppTeam.teamName}
    </Link>
  ) : (
    <>unlinked</>
  );
}

// Organisation tab (LiteLLM spec -- Views by role; App Teams spec --
// Organisation view): the headline total is the LiteLLM teams' total (AT5),
// then the LiteLLM teams table (the App teams table was removed, 2026-11-25,
// T-LP2). LiteLLM-reported figures (LT8).
export function OrganisationSection() {
  const isMobile = useIsMobile();
  const { keyParts, query } = useUrlRange();
  const result = useLiteLLMQuery(
    ["org", ...keyParts],
    `/api/litellm/org?${query}`,
    LiteLLMOrgResponseSchema,
  );
  if (result.status === "unavailable") return <Unavailable />;
  const { configured, totals, daily, dailyByTeam, litellmTeams } = result.data;
  if (configured && litellmTeams.length === 0) {
    return <Empty>No teams</Empty>;
  }
  return (
    <div className="flex flex-col gap-4">
      {configured ? (
        <>
          <OrgUsageTiles totals={totals} />
          <OrgSpendPanel
            daily={daily}
            dailyByTeam={dailyByTeam}
            dateFrom={keyParts[0]}
            dateTo={keyParts[1]}
          />
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
                  <TeamName team={team} />
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
                  <dt className="text-muted-foreground text-xs">Share</dt>
                  <dd className="font-mono tabular-nums">
                    <ShareValue
                      share={shareOf(team.spend, totals.spend)}
                      bar={false}
                    />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Requests</dt>
                  <dd className="font-mono tabular-nums">
                    {countOf(team.requests)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Tokens</dt>
                  <dd className="font-mono tabular-nums">
                    {countOf(team.tokens)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Members</dt>
                  <dd className="font-mono tabular-nums">{team.memberCount}</dd>
                </div>
                <div className="col-span-2 min-w-0">
                  <dt className="text-muted-foreground text-xs">App team</dt>
                  <dd>
                    <AppTeam team={team} />
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
              <TableHead className="text-right">Share</TableHead>
              <TableHead className={cn("text-right", HIDE_BELOW_LG)}>
                Requests
              </TableHead>
              <TableHead className={cn("text-right", HIDE_BELOW_LG)}>
                Tokens
              </TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead>App team</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {litellmTeams.map((team) => (
              <TableRow key={team.litellmTeamId}>
                <TableCell>
                  <TeamName team={team} />
                </TableCell>
                <TableCell className={NUMERIC}>
                  {formatUsd(team.spend)}
                </TableCell>
                <TableCell className={NUMERIC}>
                  <ShareValue share={shareOf(team.spend, totals.spend)} bar />
                </TableCell>
                <TableCell className={cn(NUMERIC, HIDE_BELOW_LG)}>
                  {countOf(team.requests)}
                </TableCell>
                <TableCell className={cn(NUMERIC, HIDE_BELOW_LG)}>
                  {countOf(team.tokens)}
                </TableCell>
                <TableCell className={NUMERIC}>
                  {team.maxBudget === null
                    ? "No limit"
                    : formatUsd(team.maxBudget)}
                </TableCell>
                <TableCell className={NUMERIC}>{team.memberCount}</TableCell>
                <TableCell>
                  <AppTeam team={team} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
