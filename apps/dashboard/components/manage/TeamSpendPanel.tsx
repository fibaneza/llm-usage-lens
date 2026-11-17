"use client";

import { CircleDollarSign, Gauge, Wallet } from "lucide-react";

import { formatUsd } from "@/components/charts/chart-data";
import { EmptyState } from "@/components/display/EmptyState";
import { MetricCard } from "@/components/display/MetricCard";
import { DailySpend } from "@/components/litellm/DailySpend";
import { Unavailable } from "@/components/litellm/LiteLLMSection";
import { useTeamSpendDetail } from "@/components/litellm/use-team-detail";
import { Badge } from "@/components/ui/badge";

import { BudgetBar } from "./BudgetBar";
import {
  FiguresDiffer,
  MemberSpendTable,
  coverageText,
} from "./MemberSumDetail";

const budget = (value: number | null) =>
  value === null ? "No limit" : formatUsd(value);

// Body of the Team page's spend panel. Linked: LiteLLM-reported team spend,
// budgets and the team BudgetBar, plus the member sum as a second figure when
// the server returned one (Admin, org-admin, Auditor). Unlinked: the member
// sum with its coverage and member table (App Teams spec - Spend source, UI).
// Daily buckets are LiteLLM's UTC days (LD20). "Spend" is the selected range
// (the sum of the daily rows); the budget-period spend shows only beside the
// budget (LD36).
export function TeamSpendPanel({ teamId }: { teamId: string }) {
  const result = useTeamSpendDetail(teamId);
  if (result.status === "unavailable") return <Unavailable />;
  if (result.status === "refused") {
    return (
      <p role="alert" className="text-muted-foreground py-6 text-sm">
        {result.message}
      </p>
    );
  }
  const data = result.data;
  if (data.configured === false) {
    return <EmptyState title="LiteLLM not configured" />;
  }
  if (!data.connected) {
    const { memberSum, daily } = data;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Sum of members</Badge>
          <span className="text-cell text-muted-foreground">
            {coverageText(memberSum.coverage)}
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard
            title="Spend"
            value={formatUsd(memberSum.total)}
            icon={CircleDollarSign}
          />
        </div>
        <DailySpend daily={daily} />
        <MemberSpendTable members={memberSum.members} />
        <p className="text-muted-foreground text-sm">
          This team has no LiteLLM team of its own. Budgets, limits and keys are
          managed in LiteLLM.
        </p>
      </div>
    );
  }
  const { team, daily, memberSum } = data;
  const rangeSpend = (daily ?? []).reduce((sum, d) => sum + d.spend, 0);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Badge variant="secondary">LiteLLM team</Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Spend"
          value={formatUsd(rangeSpend)}
          icon={CircleDollarSign}
        />
        {memberSum ? (
          <MetricCard
            title="Sum of members"
            value={formatUsd(memberSum.total)}
            icon={CircleDollarSign}
            description={coverageText(memberSum.coverage)}
          />
        ) : null}
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
      {memberSum ? <FiguresDiffer /> : null}
      <div className="text-cell flex flex-wrap items-center gap-x-4 gap-y-2">
        <dl className="flex items-center gap-x-4">
          <dt className="text-muted-foreground">Spent this budget period</dt>
          <dd className="font-mono tabular-nums">{formatUsd(team.spend)}</dd>
        </dl>
        {team.budgetDuration ? (
          <span className="text-muted-foreground">
            Resets every {team.budgetDuration}
          </span>
        ) : null}
        <BudgetBar spend={team.spend} budget={team.maxBudget} />
      </div>
      <DailySpend daily={daily ?? []} />
    </div>
  );
}
