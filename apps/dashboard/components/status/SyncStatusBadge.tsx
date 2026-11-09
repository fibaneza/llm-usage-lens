"use client";

import type { SyncStatus, SyncStatusResult } from "@llm-usage-lens/shared";
import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Loader,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { formatLastRun } from "@/lib/format-last-run";
import { cn } from "@/lib/utils";

type BadgeView = {
  label: string;
  text: string;
  icon: LucideIcon;
  tone?: string;
};

export const RUN_VIEWS: Record<SyncStatus["status"], BadgeView> = {
  success: {
    label: "Sync status: success",
    text: "Success",
    icon: CheckCircle2,
    tone: "text-success",
  },
  partial: {
    label: "Sync status: partial",
    text: "Partial",
    icon: TriangleAlert,
    tone: "text-warning",
  },
  error: {
    label: "Sync status: error",
    text: "Error",
    icon: XCircle,
    tone: "text-destructive",
  },
};

const NEVER_SYNCED_VIEW: BadgeView = {
  label: "Sync status: no sync yet",
  text: "No sync yet",
  icon: CircleDashed,
};

const LOADING_VIEW: BadgeView = {
  label: "Sync status: loading",
  text: "Loading",
  icon: Loader,
};

const UNAVAILABLE_VIEW: BadgeView = {
  label: "Sync status: unavailable",
  text: "Unavailable",
  icon: CircleSlash,
};

function viewFor(
  data: SyncStatusResult | undefined,
  isError: boolean,
): BadgeView {
  if (data?.state === "synced") {
    const view = RUN_VIEWS[data.status.status];
    return {
      ...view,
      label: `${view.label}, last run ${formatLastRun(data.status.lastRunAt)}`,
    };
  }
  if (data?.state === "never-synced") return NEVER_SYNCED_VIEW;
  return isError ? UNAVAILABLE_VIEW : LOADING_VIEW;
}

// Header sync indicator wired to SyncStatus (Design System — Component
// Inventory: "Last sync time + status indicator"; the last run time is in the
// aria-label and title, in UTC). The status word keeps the foreground token for
// 4.5:1 text contrast (Rule 60.30); only the icon carries the tone. A missing SyncStatus item is
// the neutral "never synced" state (Rule 20.9) and a failed request stays a
// neutral status too; both announce politely as `status`, never `alert`. Below
// `lg` only the icon shows (the label lives in the aria-label and title) so the
// top bar stays on one row (design-system — Layout).
export function SyncStatusBadge() {
  const { data, isError } = useSyncStatus();
  const view = viewFor(data, isError);
  const Icon = view.icon;

  return (
    <Badge
      variant="outline"
      role="status"
      aria-label={view.label}
      title={view.label}
      className="gap-1.5"
    >
      <Icon className={cn("size-3.5", view.tone)} aria-hidden />
      <span className="text-foreground hidden lg:inline">{view.text}</span>
    </Badge>
  );
}
