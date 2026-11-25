import { TeamSummaryPanel } from "@/components/manage/TeamSummaryPanel";
import type { TeamDirectoryEntry } from "@/lib/api/team-directory";
import type { DateRange } from "@/lib/date-range";
import { loadTeamSummary } from "@/lib/manage/team-summary";

// Reads the summary inside its own Suspense + boundary so a slow or failing
// read never blocks the page (Rule 40.4, 60.12; Design System - Team page r3).
export async function TeamSummarySection({
  entry,
  global,
  range,
  canEdit,
}: {
  entry: TeamDirectoryEntry;
  global: boolean;
  range: DateRange;
  canEdit: boolean;
}) {
  const { editTarget, ...summary } = await loadTeamSummary(entry, {
    global,
    range,
  });
  return (
    <TeamSummaryPanel
      {...summary}
      canEdit={canEdit}
      {...(canEdit && editTarget !== undefined ? { editTarget } : {})}
    />
  );
}
