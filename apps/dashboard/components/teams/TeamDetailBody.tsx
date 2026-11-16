"use client";

import { Coins, Hash, Users } from "lucide-react";

import { formatUsd } from "@/components/charts/chart-data";
import { AccountIdBadge } from "@/components/display/AccountIdBadge";
import { EmptyState } from "@/components/display/EmptyState";
import { MetricCard } from "@/components/display/MetricCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeam } from "@/hooks/useTeam";
import type { DateRange } from "@/lib/date-range";
import { withDateRange } from "@/lib/date-range-search-params";
import { ApiRequestError } from "@/lib/query/fetch-api";
import { sectionData } from "@/lib/query/section-data";

import { TeamSections } from "./TeamSections";

const countFormatter = new Intl.NumberFormat("en-US");

function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "NOT_FOUND";
}

type TeamDetailBodyProps = {
  id: string;
  range: DateRange;
  // The URL's own date values, carried into the links (issue #75).
  urlRange: Record<string, string | null>;
};

// Loads the team for the range: skeletons while pending, a not-found message
// for an unknown id, the section boundary's alert on any other failure
// (Rule 40.4, 60.12).
export function TeamDetailBody({ id, range, urlRange }: TeamDetailBodyProps) {
  const query = useTeam(id, { dateFrom: range.dateFrom, dateTo: range.dateTo });
  const notFound = isNotFound(query.error) && !query.isFetching;
  const team = notFound ? undefined : sectionData(query);

  if (notFound) {
    return (
      <EmptyState
        icon={Users}
        title="Team not found"
        description="It may have been removed or the link is wrong."
      />
    );
  }

  if (team === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const withRange = (path: string) =>
    withDateRange(path, { get: (key) => urlRange[key] ?? null });
  const tokens = team.inputTokens + team.outputTokens;
  const hasUsage = team.cost !== 0 || tokens !== 0 || team.invocations !== 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={[
          { label: "Teams", href: withRange("/dashboard/teams") },
          { label: team.teamName },
        ]}
        title={team.teamName}
        meta={
          <>
            <span className="text-cell text-muted-foreground">
              {team.departmentName}
            </span>
            {team.accounts.map((account) => (
              <AccountIdBadge
                key={account.accountId}
                accountId={account.accountId}
              />
            ))}
            <span className="text-cell text-muted-foreground">
              Bedrock service charges only
            </span>
          </>
        }
      />
      {hasUsage ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <MetricCard
              title="Total cost"
              value={formatUsd(team.cost)}
              icon={Coins}
            />
            <MetricCard
              title="Tokens"
              value={countFormatter.format(tokens)}
              icon={Hash}
            />
          </div>
          <TeamSections team={team} range={range} />
        </>
      ) : (
        <EmptyState
          icon={Users}
          title="No usage in this period"
          description="Try a wider date range."
        />
      )}
    </div>
  );
}
