import { CircleDashed } from "lucide-react";

import { Badge } from "@/components/ui/badge";

const LABEL = "Sync status: no sync yet";

// Placeholder until SyncStatus data exists (wired in Phase 4.1). A missing
// SyncStatus item is the "never synced" state and is shown neutrally — never an
// error (Rule 20.9). Below `lg` only the icon shows (the label lives in the
// aria-label and title) so the top bar stays on one row (design-system — Layout).
export function SyncStatusBadge() {
  return (
    <Badge
      variant="outline"
      role="status"
      aria-label={LABEL}
      title={LABEL}
      className="gap-1.5"
    >
      <CircleDashed className="size-3.5" aria-hidden />
      <span className="hidden lg:inline">No sync yet</span>
    </Badge>
  );
}
