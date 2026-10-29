import { Clock } from "lucide-react";

const LABEL = "Next sync: pending";

// Placeholder for the live "next sync in …" countdown. Wired to
// SyncStatus.nextScheduledAt in Phase 4.1; neutral while no sync has run
// (Rule 20.9). Hidden below sm; icon-only from sm to lg; the text joins at lg
// (Tailwind sm 640 / lg 1024). `timer` is implicitly aria-live="off", so the
// ticking value is not announced every second (WAI-ARIA timer role).
export function SyncCountdown() {
  return (
    <span
      role="timer"
      aria-label={LABEL}
      title={LABEL}
      className="text-muted-foreground hidden items-center gap-1.5 text-sm whitespace-nowrap sm:inline-flex"
    >
      <Clock className="size-3.5 shrink-0" aria-hidden />
      <span className="hidden lg:inline">Next sync —</span>
    </span>
  );
}
