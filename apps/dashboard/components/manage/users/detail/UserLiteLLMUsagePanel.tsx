"use client";

import { LiteLLMUserDetailResponseSchema } from "@llm-usage-lens/shared";
import { CircleDollarSign, Wallet } from "lucide-react";

import { formatUsd } from "@/components/charts/chart-data";
import { MetricCard } from "@/components/display/MetricCard";
import { Panel } from "@/components/display/Panel";
import { Unavailable } from "@/components/litellm/LiteLLMSection";
import { useIsClient } from "@/components/litellm/use-is-client";
import {
  useLiteLLMQueryState,
  useUrlRange,
} from "@/components/litellm/use-litellm-query";
import { idPath } from "@/components/settings/access/access-queries";
import { Skeleton } from "@/components/ui/skeleton";

// Design System - Users, round 3 (unit UP1, D-R3-13): a linked person's
// LiteLLM spend and budget for the URL date range, from
// GET /api/litellm/users/[litellmUserId]. Omitted while the response carries
// no spend (LD23). An outage is a state of the block; any other failure is
// thrown into the Panel's own boundary (Rule 60.12, 60.17).
function UsageBody({
  result,
}: {
  result: ReturnType<
    typeof useLiteLLMQueryState<typeof LiteLLMUserDetailResponseSchema>
  >;
}) {
  if (result.isError) throw result.error;
  if (!result.data) return <Skeleton className="h-24 w-full" />;
  if (result.data.status === "unavailable") return <Unavailable />;
  const { spend, maxBudget } = result.data.data;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <MetricCard
        title="Spend"
        value={
          spend === null || spend === undefined
            ? "No spend reported"
            : formatUsd(spend)
        }
        icon={CircleDollarSign}
      />
      <MetricCard
        title="Budget"
        value={
          maxBudget === null || maxBudget === undefined
            ? "No limit"
            : formatUsd(maxBudget)
        }
        icon={Wallet}
      />
    </div>
  );
}

function UsageContent({ litellmUserId }: { litellmUserId: string }) {
  const { keyParts, query } = useUrlRange();
  const result = useLiteLLMQueryState(
    ["user", litellmUserId, ...keyParts],
    `/api/litellm/users/${idPath(litellmUserId)}?${query}`,
    LiteLLMUserDetailResponseSchema,
  );
  if (result.data?.status === "ok" && result.data.data.spend === undefined) {
    return null;
  }
  return (
    <Panel title="LiteLLM usage" boundaryTitle="the LiteLLM usage">
      <UsageBody result={result} />
    </Panel>
  );
}

// Self-gating: no relative /api/ fetch during SSR or hydration (LiteLLM spec,
// "No server-side fetch of /api/*").
export function UserLiteLLMUsagePanel({
  litellmUserId,
}: {
  litellmUserId: string;
}) {
  return useIsClient() ? (
    <UsageContent litellmUserId={litellmUserId} />
  ) : (
    <Skeleton className="h-24 w-full" />
  );
}
