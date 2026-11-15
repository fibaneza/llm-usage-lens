"use client";

import { CircleDollarSign, Gauge, Wallet } from "lucide-react";

import { formatUsd } from "@/components/charts/chart-data";
import { MetricCard } from "@/components/display/MetricCard";

import { DailySpend } from "./DailySpend";
import { NotConnected, Unavailable } from "./LiteLLMSection";
import { useTeamDetail } from "./use-team-detail";

const budget = (value: number | null) =>
  value === null ? "No limit" : formatUsd(value);

export function TeamSpendSection({ teamId }: { teamId: string }) {
  const result = useTeamDetail(teamId);
  if (result.status === "unavailable") return <Unavailable />;
  const data = result.data;
  if (!data.connected) return <NotConnected />;
  const { team, daily } = data;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          title="Spend"
          value={formatUsd(team.spend)}
          icon={CircleDollarSign}
          description={
            team.budgetDuration ? `Resets every ${team.budgetDuration}` : null
          }
        />
        <MetricCard
          title="Budget"
          value={budget(team.maxBudget)}
          icon={Wallet}
        />
        <MetricCard
          title="Soft budget"
          value={budget(team.softBudget)}
          icon={Gauge}
        />
      </div>
      <DailySpend daily={daily ?? []} />
    </div>
  );
}
