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
import { useDefaultPreset } from "@/components/providers/DefaultPresetProvider";
import {
  clampCustomRange,
  type DateRange,
  fromLocalDay,
  presetForRange,
  resolvePreset,
  resolveUrlRange,
  toLocalDay,
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
  const from = format(toLocalDay(range.dateFrom), "MMM d");
  const to = format(toLocalDay(range.dateTo), "MMM d");
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
  // First click of a new range; the URL is written only once the end is chosen.
  const [pendingStart, setPendingStart] = useState<Date | undefined>();

  // URL values are untrusted: a missing or malformed range falls back to the
  // last 30 days; a valid one is order-normalised and capped at 90 days (Rule 20.8).
  const defaultPreset = useDefaultPreset();
  const range: DateRange = useMemo(
    () =>
      resolveUrlRange(params.dateFrom, params.dateTo, undefined, defaultPreset),
    [params.dateFrom, params.dateTo, defaultPreset],
  );

  const activePreset = presetForRange(range);

  function applyRange(next: DateRange) {
    setParams({ dateFrom: next.dateFrom, dateTo: next.dateTo });
  }

  function selectPreset(preset: "7d" | "30d" | "90d") {
    applyRange(resolvePreset(preset));
  }

  function onCalendarDayClick(day: Date) {
    if (!pendingStart) {
      setPendingStart(day);
      return;
    }
    applyRange(
      clampCustomRange({
        dateFrom: fromLocalDay(pendingStart),
        dateTo: fromLocalDay(day),
      }),
    );
    setPendingStart(undefined);
  }

  function onCalendarOpenChange(open: boolean) {
    setCalendarOpen(open);
    setPendingStart(undefined);
  }

  const calendarSelected: CalendarRange = pendingStart
    ? { from: pendingStart, to: undefined }
    : { from: toLocalDay(range.dateFrom), to: toLocalDay(range.dateTo) };

  const customActive = activePreset === "custom";

  return (
    // Segmented control: the preset pills and the custom-range trigger share one
    // bordered track (design reference — TopBar date toggle).
    <div className="border-border bg-card inline-flex shrink-0 items-center gap-1 rounded-lg border p-1 shadow-xs">
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

      <Popover open={calendarOpen} onOpenChange={onCalendarOpenChange}>
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
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap",
            )}
          >
            <CalendarIcon className="size-3.5 shrink-0" />
            <span
              className={cn(
                "whitespace-nowrap",
                // Visually icon-only between md and lg: the top bar has no room
                // for the bell otherwise; sr-only keeps the accessible name.
                !customActive && "md:max-xl:sr-only",
              )}
            >
              {customActive ? formatRangeLabel(range) : "Custom"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="border-border/60 w-auto rounded-xl p-2 shadow-lg"
          align="end"
        >
          <Calendar
            mode="range"
            selected={calendarSelected}
            onDayClick={onCalendarDayClick}
            defaultMonth={toLocalDay(range.dateTo)}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
