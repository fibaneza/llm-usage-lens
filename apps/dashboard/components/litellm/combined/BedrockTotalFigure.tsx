"use client";

import { Coins } from "lucide-react";

import { formatUsd } from "@/components/charts/chart-data";
import { MetricCard } from "@/components/display/MetricCard";
import { CostEstimateIndicator } from "@/components/display/CostEstimateIndicator";
import { Skeleton } from "@/components/ui/skeleton";

import { AWS_BILLED_LABEL } from "./source-labels";

export function BedrockTotalFigure({
  total,
  note,
  estimated = false,
}: {
  total: number | undefined;
  note?: string;
  estimated?: boolean;
}) {
  if (total === undefined) return <Skeleton className="h-20 w-full" />;
  return (
    <div data-testid="source-figure-bedrock">
      <MetricCard
        title="Bedrock"
        value={formatUsd(total)}
        icon={Coins}
        description={note ? `${AWS_BILLED_LABEL} · ${note}` : AWS_BILLED_LABEL}
      />
      {estimated ? (
        <div className="mt-1">
          <CostEstimateIndicator />
        </div>
      ) : null}
    </div>
  );
}
