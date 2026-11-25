"use client";

import { formatUsd } from "@/components/charts/chart-data";

import { useBudgetResetCounts } from "./use-budget-reset-counts";

type Range = { dateFrom: string; dateTo: string };
type Tally = { count: number; amount: number };

// Source: docs/specs/2026-11-10-litellm.md -- MG-D9: resets a person triggered
// through the dashboard in the selected range, not LiteLLM's scheduled ones.
export function resetCountText({ count, amount }: Tally): string {
  if (count === 0) return "No budget resets";
  const noun = count === 1 ? "reset" : "resets";
  return `${count} ${noun}, ${formatUsd(amount)}`;
}

export function OwnResetCount({ range }: { range: Range }) {
  const { data } = useBudgetResetCounts(range);
  if (!data) return null;
  return (
    <p className="text-muted-foreground text-sm">
      Your budget resets in this range: {resetCountText(data.own)}
    </p>
  );
}

export function TeamResetCount({
  teamId,
  range,
}: {
  teamId: string;
  range: Range;
}) {
  const { data } = useBudgetResetCounts(range);
  const team = data?.teams.find((t) => t.teamId === teamId);
  if (!team) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground text-sm">
        Budget resets in this range: {resetCountText(team)}
      </p>
      {team.members && team.members.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          Across {team.members.length}{" "}
          {team.members.length === 1 ? "member" : "members"}
        </p>
      ) : null}
    </div>
  );
}

// LiteLLM teams table cell: the team's count, an em dash when the caller sees no row.
export function OrgResetCell({
  teamId,
  range,
}: {
  teamId: string;
  range: Range;
}) {
  const { data } = useBudgetResetCounts(range);
  const team = data?.teams.find((t) => t.teamId === teamId);
  return <>{team ? resetCountText(team) : "\u2014"}</>;
}
