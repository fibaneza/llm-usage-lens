"use client";

import { Unavailable } from "@/components/litellm/LiteLLMSection";
import { SpendTimelinePanel } from "@/components/litellm/SpendTimelinePanel";
import { useUrlRange } from "@/components/litellm/use-litellm-query";
import { SectionBoundary } from "@/components/display/SectionBoundary";
import { Skeleton } from "@/components/ui/skeleton";

import { useProxyUser, useProxyUserState } from "./use-proxy-user";

// Design System - LiteLLM user page (unit LP3), T-LP16; LiteLLM spec - LD20
// (UTC days), LD23: the Organisation cap omits `daily`, so the panel is absent.
function TimelineBody({ litellmUserId }: { litellmUserId: string }) {
  const result = useProxyUser(litellmUserId);
  const { keyParts } = useUrlRange();
  if (result.status !== "ok") return <Unavailable />;
  const [dateFrom, dateTo] = keyParts;
  return (
    <SpendTimelinePanel
      rows={result.data.daily ?? []}
      dateFrom={dateFrom}
      dateTo={dateTo}
      description="Days are UTC days."
    />
  );
}

export function ProxyUserDailyPanel({
  litellmUserId,
}: {
  litellmUserId: string;
}) {
  const state = useProxyUserState(litellmUserId).data;
  if (state?.status === "ok" && state.data.daily === undefined) return null;
  return (
    <SectionBoundary
      title="spend over time"
      fallback={<Skeleton className="h-96 w-full" />}
    >
      <TimelineBody litellmUserId={litellmUserId} />
    </SectionBoundary>
  );
}
