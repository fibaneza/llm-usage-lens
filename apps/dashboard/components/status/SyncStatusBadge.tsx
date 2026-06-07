import { CircleDashed } from "lucide-react";

import { Badge } from "@/components/ui/badge";

// Placeholder until SyncStatus data exists (wired in Phase 4.1). A missing
// SyncStatus item is the "never synced" state and is shown neutrally — never an
// error (Rule 20.9).
export function SyncStatusBadge() {
  return (
    <Badge variant="outline" className="gap-1.5">
      <CircleDashed className="size-3.5" aria-hidden />
      No sync yet
    </Badge>
  );
}
