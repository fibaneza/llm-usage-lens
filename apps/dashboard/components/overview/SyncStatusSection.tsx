"use client";

import { KeyValueList } from "@/components/display/KeyValueList";
import { Skeleton } from "@/components/ui/skeleton";
import { useHydrated } from "@/hooks/useHydrated";
import { useMinutesUntil } from "@/hooks/useMinutesUntil";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { formatLastRun } from "@/lib/format-last-run";
import { sectionData } from "@/lib/query/section-data";

const STATUS_LABELS = {
  success: "Success",
  partial: "Partial",
  error: "Error",
} as const;

function NextSync({ nextScheduledAt }: { nextScheduledAt: string }) {
  const minutes = useMinutesUntil(nextScheduledAt);
  return minutes === null ? null : <span>{`in ${minutes} min`}</span>;
}

// Overview section 5 (Design System — Overview Page): the last run's status and
// time plus a countdown to the next one. A missing SyncStatus item is the
// neutral "never synced" state, not an error (Rule 20.9); a failed request
// throws to the section's own boundary. The header badge shares this query and
// can fill the cache before this section hydrates, so the first (hydration)
// render always shows the skeleton the server rendered.
export function SyncStatusSection() {
  const hydrated = useHydrated();
  const query = useSyncStatus();
  const result = hydrated ? sectionData(query) : undefined;

  if (result === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }

  if (result.state === "never-synced") {
    return (
      <p className="text-muted-foreground text-sm">
        No sync yet — the collector has not run.
      </p>
    );
  }

  const { status, lastRunAt, nextScheduledAt } = result.status;

  return (
    <KeyValueList
      items={[
        { term: "Status", value: STATUS_LABELS[status] },
        {
          term: "Last run",
          value: (
            <time dateTime={lastRunAt} className="font-mono">
              {formatLastRun(lastRunAt)}
            </time>
          ),
        },
        {
          term: "Next sync",
          value: <NextSync nextScheduledAt={nextScheduledAt} />,
        },
      ]}
    />
  );
}
