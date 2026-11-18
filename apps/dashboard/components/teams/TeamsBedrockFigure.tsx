"use client";

import { BedrockTotalFigure } from "@/components/litellm/combined/BedrockTotalFigure";
import { useTeams } from "@/hooks/useTeams";
import type { DateRange } from "@/lib/date-range";
import { sectionData } from "@/lib/query/section-data";

// M5-D1: the organisation-wide total, so the department filter does not narrow it.
export function TeamsBedrockFigure({ range }: { range: DateRange }) {
  const teams = sectionData(
    useTeams({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
  );
  return (
    <BedrockTotalFigure
      total={teams?.teams.reduce((sum, team) => sum + team.cost, 0)}
      note="All teams"
    />
  );
}
