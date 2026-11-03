"use client";

import { Clock } from "lucide-react";

import { useMinutesUntil } from "@/hooks/useMinutesUntil";
import { useSyncStatus } from "@/hooks/useSyncStatus";

const PENDING_LABEL = "Next sync: pending";

// Live "next sync in N min" countdown to SyncStatus.nextScheduledAt (Design
// System — Component Inventory). Neutral "pending" while loading, when no sync
// has run (Rule 20.9) or when the request fails. Hidden below sm; icon-only
// from sm to lg; the text joins at lg (Tailwind sm 640 / lg 1024). `timer` is
// implicitly aria-live="off", so the ticking value is not announced every
// second (WAI-ARIA timer role); aria-label and title carry the one value.
export function SyncCountdown() {
  const { data } = useSyncStatus();
  const nextScheduledAt =
    data?.state === "synced" ? data.status.nextScheduledAt : undefined;
  const minutes = useMinutesUntil(nextScheduledAt);

  const label =
    minutes === null ? PENDING_LABEL : `Next sync in ${minutes} min`;

  return (
    <span
      role="timer"
      aria-label={label}
      title={label}
      className="text-muted-foreground hidden items-center gap-1.5 text-sm whitespace-nowrap sm:inline-flex"
    >
      <Clock className="size-3.5 shrink-0" aria-hidden />
      <span className="hidden lg:inline">
        {minutes === null ? "Next sync —" : label}
      </span>
    </span>
  );
}
