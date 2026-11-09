"use client";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { SyncCountdown } from "@/components/status/SyncCountdown";
import { RUN_VIEWS } from "@/components/status/SyncStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useHydrated } from "@/hooks/useHydrated";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { formatLastRun } from "@/lib/format-last-run";
import { sectionData } from "@/lib/query/section-data";

function formatDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-4 w-40" />
    </div>
  );
}

function SyncStatusBody() {
  const hydrated = useHydrated();
  const query = useSyncStatus();
  const result = hydrated ? sectionData(query) : undefined;

  if (result === undefined) return <PanelSkeleton />;

  if (result.state === "never-synced") {
    return (
      <p className="text-muted-foreground text-sm">
        Never synced — the collector has not run yet.
      </p>
    );
  }

  const s = result.status;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline">{RUN_VIEWS[s.status].text}</Badge>
        <SyncCountdown />
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Last run</dt>
        <dd>
          <time dateTime={s.lastRunAt} className="font-mono">
            {formatLastRun(s.lastRunAt)}
          </time>
        </dd>
        <dt className="text-muted-foreground">Accounts processed</dt>
        <dd className="font-mono">{`${s.accountsSuccess} of ${s.accountsTotal}`}</dd>
        <dt className="text-muted-foreground">Failed</dt>
        <dd className="font-mono">{s.accountsFailed}</dd>
        <dt className="text-muted-foreground">Last run status</dt>
        <dd>{RUN_VIEWS[s.status].text}</dd>
        <dt className="text-muted-foreground">Duration</dt>
        <dd className="font-mono">{formatDuration(s.durationMs)}</dd>
      </dl>
      {s.errors.length > 0 ? (
        <ul aria-label="Sync errors" className="flex flex-col gap-1 text-sm">
          {s.errors.map((e) => (
            <li key={`${e.accountId}:${e.message}`}>
              <span className="font-mono">{e.accountId}</span>
              {" — "}
              {e.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Phase 4.9 sync panel (Data Model — Entity: SyncStatus). A missing item is
// the neutral never-synced state (Rule 20.9); a failed request is isolated by
// the panel's own boundary (Rule 40.4).
export function SyncStatusPanel() {
  return (
    <SectionBoundary title="the sync status" fallback={<PanelSkeleton />}>
      <SyncStatusBody />
    </SectionBoundary>
  );
}
