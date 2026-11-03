"use client";

import { MODEL_META } from "@bedrock-usage/shared";
import { Activity, Building2, Coins, DollarSign, Sparkles } from "lucide-react";

import { formatUsd } from "@/components/charts/chart-data";
import { DeltaBadge } from "@/components/display/DeltaBadge";
import { MetricCard } from "@/components/display/MetricCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useOverview } from "@/hooks/useOverview";
import { type DateRange, previousRange } from "@/lib/date-range";
import { sectionData } from "@/lib/query/section-data";

import { RecurringIndicator } from "./RecurringIndicator";

const KPI_GRID =
  "grid gap-4 md:grid-cols-2 lg:grid-cols-3 min-[1440px]:grid-cols-5";
const KPI_SKELETON_KEYS = [
  "total-cost",
  "total-tokens",
  "total-invocations",
  "most-used-model",
  "active-accounts",
] as const;

const countFormatter = new Intl.NumberFormat("en-US");

type KpiRowProps = {
  range: DateRange;
};

// Overview section 1 (Design System — Overview Page): five KPI cards. The
// Total Cost delta compares against the period immediately before the range via
// a second, non-blocking request — if it fails the KPIs still render, just
// without a delta. The cost split and scope note follow the Data Model spec —
// Dashboard impact (v1).
export function KpiRow({ range }: KpiRowProps) {
  const params = { dateFrom: range.dateFrom, dateTo: range.dateTo };
  const previous = previousRange(range);
  const overview = sectionData(useOverview(params));
  const previousOverview = useOverview({
    dateFrom: previous.dateFrom,
    dateTo: previous.dateTo,
  });

  if (overview === undefined) {
    return (
      <div className={KPI_GRID}>
        {KPI_SKELETON_KEYS.map((key) => (
          <Skeleton key={key} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const recurring = overview.nonModelByCategory
    .filter((entry) => entry.recurring)
    .map((entry) => entry.category);
  const mostUsed =
    overview.mostUsedModel === null
      ? "—"
      : MODEL_META[overview.mostUsedModel].displayName;

  return (
    <div className={KPI_GRID}>
      <MetricCard
        title="Total Cost"
        value={formatUsd(overview.totalCost)}
        icon={DollarSign}
        trend={
          <DeltaBadge
            current={overview.totalCost}
            previous={previousOverview.data?.totalCost ?? null}
          />
        }
        description={
          <>
            <p>{`Model ${formatUsd(overview.modelCost)} · Non-model ${formatUsd(overview.nonModelCost)}`}</p>
            <p>Bedrock service charges only</p>
            <RecurringIndicator categories={recurring} />
          </>
        }
      />
      <MetricCard
        title="Total Tokens"
        value={countFormatter.format(
          overview.inputTokens + overview.outputTokens,
        )}
        icon={Coins}
      />
      <MetricCard
        title="Total Invocations"
        value={countFormatter.format(overview.invocations)}
        icon={Activity}
      />
      <MetricCard title="Most Used Model" value={mostUsed} icon={Sparkles} />
      <MetricCard
        title="Active Accounts"
        value={countFormatter.format(overview.activeAccounts)}
        icon={Building2}
      />
    </div>
  );
}
