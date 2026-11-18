"use client";

import { BedrockTotalFigure } from "@/components/litellm/combined/BedrockTotalFigure";
import { useUsers } from "@/hooks/useUsers";
import type { DateRange } from "@/lib/date-range";
import { sectionData } from "@/lib/query/section-data";

// Same query key as UsersBody, so the figure adds no request (M5-D1).
export function UsersBedrockFigure({ range }: { range: DateRange }) {
  const users = sectionData(
    useUsers({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
  );
  const total = users?.users.reduce((sum, r) => sum + r.cost, 0);
  return <BedrockTotalFigure total={total} note="Model usage only" estimated />;
}
