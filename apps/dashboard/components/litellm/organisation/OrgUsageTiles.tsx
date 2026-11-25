import { CircleDollarSign, Coins, Hash, Sigma } from "lucide-react";

import { formatUsd } from "@/components/charts/chart-data";
import { MetricCard } from "@/components/display/MetricCard";

import { formatCount } from "./format";

type OrgUsageTilesProps = {
  totals: {
    spend: number;
    requests?: number | undefined;
    tokens?: number | undefined;
    failedRequests?: number | undefined;
  };
};

const ABSENT = "—";

// Design System -- LiteLLM Organisation spend chart (unit OC1, T-OC5):
// LiteLLM-reported range totals; the average is spend / requests.
export function OrgUsageTiles({ totals }: OrgUsageTilesProps) {
  const { spend, requests, tokens } = totals;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="Total spend"
        value={formatUsd(spend)}
        icon={CircleDollarSign}
      />
      <MetricCard
        title="Requests"
        value={requests === undefined ? ABSENT : formatCount(requests)}
        icon={Hash}
      />
      <MetricCard
        title="Tokens"
        value={tokens === undefined ? ABSENT : formatCount(tokens)}
        icon={Sigma}
      />
      <MetricCard
        title="Average cost per request"
        value={requests ? formatUsd(spend / requests) : ABSENT}
        icon={Coins}
      />
    </div>
  );
}
