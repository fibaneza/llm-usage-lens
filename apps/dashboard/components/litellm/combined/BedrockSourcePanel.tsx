"use client";

import type { ReactNode } from "react";

import { Panel } from "@/components/display/Panel";
import { Badge } from "@/components/ui/badge";

import { AWS_BILLED_LABEL } from "./source-labels";

type SourcePanelProps = {
  boundaryTitle: string;
  resetKeys: readonly unknown[];
  description?: ReactNode;
  flush?: boolean;
  children: ReactNode;
};

// Design System -- Source panels (D17): the page's existing Bedrock body,
// labelled AWS-billed, in its own boundary so a LiteLLM outage never reaches it.
export function BedrockSourcePanel({
  boundaryTitle,
  resetKeys,
  description,
  flush,
  children,
}: SourcePanelProps) {
  return (
    <Panel
      title="Bedrock"
      badge={<Badge variant="outline">{AWS_BILLED_LABEL}</Badge>}
      boundaryTitle={boundaryTitle}
      resetKeys={resetKeys}
      description={description}
      flush={flush}
    >
      {children}
    </Panel>
  );
}
