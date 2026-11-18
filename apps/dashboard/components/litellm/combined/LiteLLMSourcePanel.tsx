"use client";

import type { ReactNode } from "react";

import { Panel } from "@/components/display/Panel";
import { LiteLLMReportedBadge } from "@/components/litellm/LiteLLMReportedBadge";
import { useIsClient } from "@/components/litellm/use-is-client";
import { Skeleton } from "@/components/ui/skeleton";

type SourcePanelProps = {
  boundaryTitle: string;
  resetKeys: readonly unknown[];
  description?: ReactNode;
  flush?: boolean;
  children: ReactNode;
};

// Design System -- Source panels (D17): LiteLLM reads run in the browser only
// (LiteLLM spec -- "No server-side fetch of /api/*"), so the body renders once
// mounted.
export function LiteLLMSourcePanel({
  boundaryTitle,
  resetKeys,
  description,
  flush,
  children,
}: SourcePanelProps) {
  const isClient = useIsClient();
  return (
    <Panel
      title="LiteLLM"
      badge={<LiteLLMReportedBadge />}
      boundaryTitle={boundaryTitle}
      resetKeys={resetKeys}
      description={description}
      flush={flush}
    >
      {isClient ? children : <Skeleton className="h-40 w-full" />}
    </Panel>
  );
}
