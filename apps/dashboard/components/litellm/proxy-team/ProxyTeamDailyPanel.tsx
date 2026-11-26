"use client";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { Unavailable } from "@/components/litellm/LiteLLMSection";
import { SpendTimelinePanel } from "@/components/litellm/SpendTimelinePanel";
import { Skeleton } from "@/components/ui/skeleton";
import { useUrlRange } from "@/components/litellm/use-litellm-query";

import { useProxyTeamDailyState } from "./use-proxy-team-daily";

// Design System - LiteLLM team page (unit LP3), T-LP16; LiteLLM spec - LD20
// (UTC days), LD23: the Organisation cap omits `daily`, so the panel is absent.
function TimelineBody({ litellmTeamId }: { litellmTeamId: string }) {
  const query = useProxyTeamDailyState(litellmTeamId);
  const { keyParts } = useUrlRange();
  if (query.isError) throw query.error;
  const result = query.data;
  if (result === undefined) return <Skeleton className="h-96 w-full" />;
  if (result.status !== "ok") return <Unavailable />;
  if (result.data.daily === undefined) return null;
  const [dateFrom, dateTo] = keyParts;
  return (
    <SpendTimelinePanel
      rows={result.data.daily}
      dateFrom={dateFrom}
      dateTo={dateTo}
      description="Days are UTC days."
    />
  );
}

export function ProxyTeamDailyPanel({
  litellmTeamId,
}: {
  litellmTeamId: string;
}) {
  return (
    <SectionBoundary title="spend over time">
      <TimelineBody litellmTeamId={litellmTeamId} />
    </SectionBoundary>
  );
}
