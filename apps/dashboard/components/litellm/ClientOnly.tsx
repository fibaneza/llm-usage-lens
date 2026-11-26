"use client";

import type { ReactNode } from "react";

import { useIsClient } from "@/components/litellm/use-is-client";
import { Skeleton } from "@/components/ui/skeleton";

// LiteLLM spec - Design System integration notes, "No server-side fetch of
// /api/*": suspense reads of a relative /api URL cannot run during SSR, so
// the server and the first client render show a skeleton.
export function ClientOnly({ children }: { children: ReactNode }) {
  return useIsClient() ? children : <Skeleton className="h-24 w-full" />;
}
