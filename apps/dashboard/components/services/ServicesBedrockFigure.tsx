"use client";

import { BedrockTotalFigure } from "@/components/litellm/combined/BedrockTotalFigure";
import { useServices } from "@/hooks/useServices";
import type { DateRange } from "@/lib/date-range";
import { sectionData } from "@/lib/query/section-data";

// Design System -- Source panels, M5-D1: the page's own total, model usage
// only; the same query key as the table, so no extra request.
export function ServicesBedrockFigure({ range }: { range: DateRange }) {
  const services = sectionData(
    useServices({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
  );
  const total = services?.services.reduce((sum, row) => sum + row.cost, 0);
  return <BedrockTotalFigure total={total} note="Model usage only" estimated />;
}
