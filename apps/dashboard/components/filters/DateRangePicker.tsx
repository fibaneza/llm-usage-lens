"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import type { DateRange as CalendarRange } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  clampCustomRange,
  type DateRange,
  defaultDateRange,
  formatDay,
  parseDay,
  presetForRange,
  resolvePreset,
} from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";
import { cn } from "@/lib/utils";

// Short segmented-control labels (design reference — the top-bar toggle reads
// "7D / 30D / 90D", not "Last 7 days"); the long form is the accessible name.
const PRESET_PILLS = [
  { preset: "7d", label: "7D", aria: "Last 7 days" },
  { preset: "30d", label: "30D", aria: "Last 30 days" },
  { preset: "90d", label: "90D", aria: "Last 90 days" },
] as const;

function formatRangeLabel(range: DateRange): string {
  const from = format(parseDay(range.dateFrom), "MMM d");
  const to = format(parseDay(range.dateTo), "MMM d");
  return `${from} – ${to}`;
}

// One segment of the control. Active = filled primary indigo; inactive = muted
// text on the track (design reference — Color: active preset uses the brand
// primary). aria-pressed exposes the toggle state to assistive tech.
function pillClassName(active: boolean): string {
  return cn(
    "h-7 rounded-md px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    active
      ? "bg-primary text-primary-foreground"
      : "text-muted-foreground hover:text-foreground",
  );
}

export function DateRangePicker() {
  const [params, setParams] = useQueryStates(dateRangeSearchParams);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Default to the last 30 days when the URL carries no range (Rule 20.8 cap is
  // applied on every custom selection below).
  const range: DateRange = useMemo(() => {
    if (params.dateFrom && params.dateTo) {
      return { dateFrom: params.dateFrom, dateTo: params.dateTo };
    }
    return defaultDateRange();
  }, [params.dateFrom, params.dateTo]);

  const activePreset = presetForRange(range);

  function applyRange(next: DateRange) {
    setParams({ dateFrom: next.dateFrom, dateTo: next.dateTo });
  }

  function selectPreset(preset: "7d" | "30d" | "90d") {
    applyRange(resolvePreset(preset));
  }

  function onCalendarSelect(selected: CalendarRange | undefined) {
    if (!selected?.from) return;
    const to = selected.to ?? selected.from;
    applyRange(
      clampCustomRange({
        dateFrom: formatDay(selected.from),
        dateTo: formatDay(to),
      }),
    );
  }

  const calendarSelected: CalendarRange = {
    from: parseDay(range.dateFrom),
    to: parseDay(range.dateTo),
  };

  const customActive = activePreset === "custom";

  return (
    // Segmented control: the preset pills and the custom-range trigger share one
    // bordered track (design reference — TopBar date toggle).
    <div className="border-border bg-card inline-flex items-center gap-1 rounded-lg border p-1 shadow-xs">
      {PRESET_PILLS.map(({ preset, label, aria }) => (
        <button
          key={preset}
          type="button"
          aria-label={aria}
          aria-pressed={activePreset === preset}
          onClick={() => selectPreset(preset)}
          className={pillClassName(activePreset === preset)}
        >
          {label}
        </button>
      ))}

      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={
              customActive
                ? `Custom date range: ${formatRangeLabel(range)}`
                : "Custom date range"
            }
            aria-pressed={customActive}
            className={cn(
              pillClassName(customActive),
              "flex items-center gap-1.5",
            )}
          >
            <CalendarIcon className="size-3.5" />
            <span>{customActive ? formatRangeLabel(range) : "Custom"}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="border-border/60 w-auto rounded-xl p-2 shadow-lg"
          align="end"
        >
          <Calendar
            mode="range"
            selected={calendarSelected}
            onSelect={onCalendarSelect}
            defaultMonth={parseDay(range.dateTo)}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
