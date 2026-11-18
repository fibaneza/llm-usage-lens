"use client";

import { Coins } from "lucide-react";
import type { ReactNode } from "react";

import { formatUsd } from "@/components/charts/chart-data";
import { MetricCard } from "@/components/display/MetricCard";
import { SectionBoundary } from "@/components/display/SectionBoundary";
import { LiteLLMReportedBadge } from "@/components/litellm/LiteLLMReportedBadge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { CombinedBoundary } from "./CombinedBoundary";
import { CombinedFigure } from "./CombinedFigure";
import { CombinedWarning } from "./CombinedWarning";
import { LITELLM_NOT_CONFIGURED } from "./source-labels";
import {
  useCombinedOrganisation,
  type CombinedRange,
} from "./use-combined-query";

function LiteLLMAndCombined({ range }: { range: CombinedRange }) {
  const response = useCombinedOrganisation(range);
  if (!response || response.visibility === "hidden") return null;
  const { litellm, combined } = response;
  const warning =
    response.visibility === "warn" ? (
      <div className="md:col-span-3">
        <CombinedWarning />
      </div>
    ) : null;

  if (!response.configured || litellm == null || combined == null) {
    return (
      <>
        {warning}
        <div data-testid="source-figure-litellm">
          <MetricCard
            title="LiteLLM"
            value="Not configured"
            icon={Coins}
            description={LITELLM_NOT_CONFIGURED}
          />
        </div>
      </>
    );
  }

  return (
    <>
      {warning}
      <div data-testid="source-figure-litellm">
        <MetricCard
          title="LiteLLM"
          value={formatUsd(litellm)}
          icon={Coins}
          description={
            <span className="flex flex-wrap items-center gap-x-2">
              <LiteLLMReportedBadge />
              <span>LiteLLM teams only</span>
            </span>
          }
        />
      </div>
      <Card
        role="group"
        aria-label="Combined"
        data-testid="source-figure-combined"
        className="gap-1 px-4 py-3"
      >
        <p className="text-muted-foreground text-xs font-medium">Combined</p>
        <CombinedFigure
          combined={combined}
          bedrockDirect={response.bedrockDirect}
          litellm={litellm}
          byProvider={response.byProvider}
          costEstimated={response.costEstimated}
          provisional={response.provisional}
        />
      </Card>
    </>
  );
}

// Design System -- Source panels (D18): Bedrock | LiteLLM | Combined. The
// Combined value is the server's `combined`, never a client-side sum (LT-MI4).
export function SourceFigures({
  range,
  bedrock,
}: {
  range: CombinedRange;
  bedrock: ReactNode;
}) {
  const resetKeys = [range.dateFrom, range.dateTo];
  return (
    <div
      role="group"
      aria-label="Source totals"
      className="grid grid-cols-1 gap-4 md:grid-cols-3"
    >
      <SectionBoundary title="the Bedrock total" resetKeys={resetKeys}>
        {bedrock}
      </SectionBoundary>
      <CombinedBoundary
        title="the LiteLLM and combined totals"
        resetKeys={resetKeys}
        fallback={<Skeleton className="h-20 w-full md:col-span-2" />}
      >
        <LiteLLMAndCombined range={range} />
      </CombinedBoundary>
    </div>
  );
}
