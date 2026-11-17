"use client";

import { CircleDollarSign, Gauge, Wallet } from "lucide-react";

import { formatUsd } from "@/components/charts/chart-data";
import { MetricCard } from "@/components/display/MetricCard";
import { DailySpend } from "@/components/litellm/DailySpend";
import { NotConnected, Unavailable } from "@/components/litellm/LiteLLMSection";
import { useTeamDetail } from "@/components/litellm/use-team-detail";

import { BudgetBar } from "./BudgetBar";

const budget = (value: number | null) =>
  value === null ? "No limit" : formatUsd(value);

// Body of the Team page's "Team spend & budgets" panel: LiteLLM-reported team
// spend, budgets and the team BudgetBar (Design System - Management pages,
// Team; Budget as a bar). Daily buckets are LiteLLM's UTC days (LD20).
export function TeamSpendPanel({ teamId }: { teamId: string }) {
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
      <BudgetBar spend={team.spend} budget={team.maxBudget} />
      <DailySpend daily={daily ?? []} />
    </div>
  );
}
