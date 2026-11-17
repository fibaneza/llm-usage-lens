"use client";

import type { ReactNode } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { useIsClient } from "@/components/litellm/use-is-client";
import { Skeleton } from "@/components/ui/skeleton";

// Self-gating: no relative /api/ fetch during SSR or hydration (LiteLLM spec,
// "No server-side fetch of /api/*"). A hidden response renders nothing, so the
// boundary sits outside the Panel the content may or may not draw.
export function CombinedBoundary({
  title,
  resetKeys,
  fallback = <Skeleton className="h-40 w-full" />,
  children,
}: {
  title: string;
  resetKeys: readonly unknown[];
  // A card that is usually absent (Team Detail) loads without a placeholder.
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return useIsClient() ? (
    <SectionBoundary title={title} resetKeys={resetKeys} fallback={fallback}>
      {children}
    </SectionBoundary>
  ) : (
    fallback
  );
}
