"use client";

import { LiteLLMTeamDetailResponseSchema } from "@llm-usage-lens/shared";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CircleDollarSign, Gauge, Wallet } from "lucide-react";
import type { z } from "zod";

import { formatUsd } from "@/components/charts/chart-data";
import { EmptyState } from "@/components/display/EmptyState";
import { MetricCard } from "@/components/display/MetricCard";
import { DailySpend } from "@/components/litellm/DailySpend";
import { Unavailable } from "@/components/litellm/LiteLLMSection";
import { useUrlRange } from "@/components/litellm/use-litellm-query";
import type { LiteLLMResult } from "@/components/litellm/use-litellm-query";
import { useIsClient } from "@/components/litellm/use-is-client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError, fetchApi } from "@/lib/query/fetch-api";

import { BudgetBar } from "./BudgetBar";
import {
  FiguresDiffer,
  MemberSpendTable,
  coverageText,
} from "./MemberSumDetail";

const budget = (value: number | null) =>
  value === null ? "No limit" : formatUsd(value);

type TeamSpendDetail =
  | LiteLLMResult<z.output<typeof LiteLLMTeamDetailResponseSchema>>
  | { status: "refused"; message: string };

// The member sum is requested only when asked for (a global reader); a Lead's
// request carries no parameter (App Teams spec - AT6; LiteLLM spec - LT28). A
// team above the member cap answers 422, shown in the panel, not thrown into
// its boundary.
function useTeamUsageSpend(teamId: string, includeMemberSum: boolean) {
  const { keyParts, query } = useUrlRange();
  return useSuspenseQuery({
    queryKey: [
      "litellm",
      "team",
      teamId,
      ...keyParts,
      includeMemberSum ? "memberSum" : "plain",
    ],
    queryFn: async (): Promise<TeamSpendDetail> => {
      try {
        const suffix = includeMemberSum ? "&include=memberSum" : "";
        return {
          status: "ok",
          data: await fetchApi(
            `/api/litellm/teams/${encodeURIComponent(teamId)}?${query}${suffix}`,
            LiteLLMTeamDetailResponseSchema,
          ),
        };
      } catch (error) {
        if (error instanceof ApiRequestError) {
          if (error.code === "LITELLM_UNAVAILABLE") {
            return { status: "unavailable" };
          }
          if (error.code === "TOO_MANY_MEMBERS") {
            return { status: "refused", message: error.message };
          }
        }
        throw error;
      }
    },
  }).data;
}

// Body of the Team usage page's spend panel. Linked: LiteLLM-reported team spend,
// budgets and the team BudgetBar, plus the member sum as a second figure when
// the server returned one (Admin, org-admin, Auditor). Unlinked: the member
// sum with its coverage and member table (App Teams spec - Spend source, UI).
// Daily buckets are LiteLLM's UTC days (LD20). "Spend" is the selected range
// (the sum of the daily rows); the budget-period spend shows only beside the
// budget (LD36).
// Self-gating: no relative /api/ fetch during SSR or hydration (LiteLLM spec,
// "No server-side fetch of /api/*").
export function TeamSpendPanel(props: {
  teamId: string;
  includeMemberSum: boolean;
}) {
  return useIsClient() ? (
    <TeamSpendContent {...props} />
  ) : (
    <Skeleton className="h-40 w-full" />
  );
}

function TeamSpendContent({
  teamId,
  includeMemberSum,
}: {
  teamId: string;
  includeMemberSum: boolean;
}) {
  const result = useTeamUsageSpend(teamId, includeMemberSum);
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
