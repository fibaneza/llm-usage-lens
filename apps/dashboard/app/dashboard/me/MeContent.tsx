"use client";

import { Activity, Coins, DollarSign } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useMemo } from "react";

import {
  formatUsd,
  toModelBreakdownSlices,
} from "@/components/charts/chart-data";
import {
  LazyDailyCostBarChart,
  LazyModelBreakdownChart,
} from "@/components/charts/LazyCharts";
import { EmptyState } from "@/components/display/EmptyState";
import { MetricCard } from "@/components/display/MetricCard";
import { Panel } from "@/components/display/Panel";
import { SectionBoundary } from "@/components/display/SectionBoundary";
import { CombinedMeCard } from "@/components/litellm/combined/CombinedMeCard";
import { LiteLLMSection } from "@/components/litellm/LiteLLMSection";
import { MyUsageSection } from "@/components/litellm/MyUsageSection";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/useMe";
import { useMeUsage } from "@/hooks/useMeUsage";
import { useDefaultPreset } from "@/components/providers/DefaultPresetProvider";
import { resolveUrlRange, type DateRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";
import { sectionData } from "@/lib/query/section-data";

const countFormatter = new Intl.NumberFormat("en-US");

// Source: Design System - Access states and scoped labels (No team: My usage
// plus "Ask your team lead for access"; Not visible: a neutral inline notice,
// never a zero); Access Control spec - Roles (My usage: any signed-in role).
export function MeContent() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const defaultPreset = useDefaultPreset();
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo, undefined, defaultPreset),
    [dateFrom, dateTo, defaultPreset],
  );

  return (
    <div className="flex flex-col gap-6">
      <SectionBoundary title="your access" resetKeys={[]}>
        <AccessNotice />
        <BudgetIncreaseLink />
      </SectionBoundary>
      <CombinedMeCard range={range} />
      <section className="flex flex-col gap-4">
        <h2 className="text-foreground text-lg font-semibold">
          Your Bedrock usage
        </h2>
        <SectionBoundary
          title="your usage"
          resetKeys={[range.dateFrom, range.dateTo]}
        >
          <OwnUsage range={range} />
        </SectionBoundary>
      </section>
      <LiteLLMSection title="LiteLLM usage" reported>
        <MyUsageSection />
      </LiteLLMSection>
    </div>
  );
}

// Design System - Management pages, My usage: a mailto: link to the caller's
// team lead, absent when none is known. No outbound-message feature.
function BudgetIncreaseLink() {
  const me = sectionData(useMe());
  const lead = me?.leadEmail;
  if (!lead) return null;
  return (
    <a
      href={`mailto:${encodeURIComponent(lead)}?subject=${encodeURIComponent("Budget increase request")}`}
      className="text-primary text-sm font-medium underline-offset-4 hover:underline"
    >
      Request a budget increase
    </a>
  );
}

function AccessNotice() {
  const me = sectionData(useMe());
  if (me === undefined) return null;
  const noTeam =
    !me.global &&
    me.memberTeamId === null &&
    me.teamScopes.length === 0 &&
    me.departmentScopes.length === 0;
  if (noTeam) {
    return (
      <p className="text-muted-foreground max-w-[72ch] text-sm">
        You are not on a team yet. Ask your team lead for access.
      </p>
    );
  }
  if (me.memberTeamId !== null && !me.memberTeamVisible) {
    return (
      <p className="text-muted-foreground max-w-[72ch] text-sm">
        Your team&apos;s usage is not visible to you.
      </p>
    );
  }
  return null;
}

function OwnUsage({ range }: { range: DateRange }) {
  const usage = sectionData(
    useMeUsage({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
  );
  if (usage === undefined) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {["cost", "tokens", "invocations"].map((key) => (
          <Skeleton key={key} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (usage.daily.length === 0) {
    return (
      <EmptyState
        title="No Bedrock usage in this range"
        description="Usage appears here when requests are made under your identity."
      />
    );
  }
  const { totals } = usage;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Total cost"
          value={formatUsd(totals.cost)}
          icon={DollarSign}
        />
        <MetricCard
          title="Tokens"
          value={countFormatter.format(
            totals.inputTokens + totals.outputTokens,
          )}
          icon={Coins}
          description={`${countFormatter.format(totals.inputTokens)} in, ${countFormatter.format(totals.outputTokens)} out`}
        />
        <MetricCard
          title="Invocations"
          value={countFormatter.format(totals.invocations)}
          icon={Activity}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Spend by day" boundaryTitle="spend by day">
          <LazyDailyCostBarChart
            data={usage.daily.map(({ date, cost }) => ({ date, cost }))}
            label="Your spend by day"
          />
        </Panel>
        <Panel title="Spend by model" boundaryTitle="spend by model">
          <LazyModelBreakdownChart
            slices={toModelBreakdownSlices(usage.byModel, 0)}
          />
        </Panel>
      </div>
    </div>
  );
}
