"use client";

import { DailySpend } from "@/components/litellm/DailySpend";
import { Unavailable } from "@/components/litellm/LiteLLMSection";
import { Panel } from "@/components/display/Panel";

import { useProxyUser, useProxyUserState } from "./use-proxy-user";

// Design System - LiteLLM user page (unit LP2), T-LP8; LiteLLM spec - LD20
// (UTC days), LD23: the Organisation cap omits `daily`, so the panel is absent.
function DailyBody({ litellmUserId }: { litellmUserId: string }) {
  const result = useProxyUser(litellmUserId);
  if (result.status !== "ok") return <Unavailable />;
  return <DailySpend daily={result.data.daily ?? []} />;
}

export function ProxyUserDailyPanel({
  litellmUserId,
}: {
  litellmUserId: string;
}) {
  const state = useProxyUserState(litellmUserId).data;
  if (state?.status === "ok" && state.data.daily === undefined) return null;
  return (
    <Panel
      title="Daily spend"
      boundaryTitle="Daily spend"
      description="Days are UTC days."
    >
      <DailyBody litellmUserId={litellmUserId} />
    </Panel>
  );
}
