import { Clock } from "lucide-react";

// Placeholder for the live "next sync in …" countdown. Wired to
// SyncStatus.nextScheduledAt in Phase 4.1; neutral while no sync has run
// (Rule 20.9). Hidden below sm; icon-only from sm to lg; the text joins at lg
// (Tailwind sm 640 / lg 1024).
export function SyncCountdown() {
  return (
    <span
      role="status"
      aria-label="Next sync: pending"
      title="Next sync: pending"
      className="text-muted-foreground hidden items-center gap-1.5 text-sm whitespace-nowrap sm:inline-flex"
    >
      <Clock className="size-3.5 shrink-0" aria-hidden />
      <span className="hidden lg:inline">Next sync —</span>
    </span>
  );
}
