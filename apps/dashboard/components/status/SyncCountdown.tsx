import { Clock } from "lucide-react";

// Placeholder for the live "next sync in …" countdown. Wired to
// SyncStatus.nextScheduledAt in Phase 4.1; neutral while no sync has run
// (Rule 20.9).
export function SyncCountdown() {
  return (
    <span className="text-muted-foreground hidden items-center gap-1.5 text-sm sm:inline-flex">
      <Clock className="size-3.5" aria-hidden />
      Next sync —
    </span>
  );
}
