"use client";

import { SyncStatusResultSchema } from "@llm-usage-lens/shared";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { fetchApi } from "@/lib/query/fetch-api";
import { cn } from "@/lib/utils";

const SYNC_STATUS_KEY = "sync-status";

// Design System — Caching Strategy, Refresh (T-RF1, T-RF2): one no-cache
// sync-status read, every other query refetched once, then the page refresh.
export function RefreshButton({ syncStatus }: { syncStatus: boolean }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const fetching = useIsFetching() > 0;
  const reduceMotion = usePrefersReducedMotion();
  const [pending, startTransition] = useTransition();
  const busy = fetching || pending;

  const [announce, setAnnounce] = useState("");
  const clicked = useRef(false);

  useEffect(() => {
    if (busy && clicked.current) {
      setAnnounce("Refreshing…");
    } else if (!busy && clicked.current) {
      clicked.current = false;
      setAnnounce("Updated");
    }
  }, [busy]);

  function onClick() {
    if (busy) return;
    clicked.current = true;
    setAnnounce("Refreshing…");
    if (syncStatus) {
      void queryClient.fetchQuery({
        queryKey: [SYNC_STATUS_KEY],
        queryFn: () =>
          fetchApi("/api/sync-status", SyncStatusResultSchema, {
            headers: { "Cache-Control": "no-cache" },
          }),
        staleTime: 0,
      });
      void queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== SYNC_STATUS_KEY,
      });
    } else {
      void queryClient.invalidateQueries();
    }
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Refresh data"
            aria-disabled={busy ? "true" : undefined}
            aria-busy={busy ? "true" : undefined}
            onClick={onClick}
          >
            <RefreshCw
              aria-hidden="true"
              className={cn(busy && !reduceMotion && "animate-spin")}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Reload the data on this page. The next sync from AWS runs on schedule.
        </TooltipContent>
      </Tooltip>
      <span role="status" className="sr-only">
        {announce}
      </span>
    </TooltipProvider>
  );
}
