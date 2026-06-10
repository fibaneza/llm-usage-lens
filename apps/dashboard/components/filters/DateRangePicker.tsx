"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import type { DateRange as CalendarRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  clampCustomRange,
  type DateRange,
  type DateRangePreset,
  defaultDateRange,
  formatDay,
  parseDay,
  presetForRange,
  resolvePreset,
} from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

const PRESET_LABELS: Record<DateRangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  custom: "Custom range",
};

function formatRangeLabel(range: DateRange): string {
  const from = format(parseDay(range.dateFrom), "MMM d, yyyy");
  const to = format(parseDay(range.dateTo), "MMM d, yyyy");
  return `${from} – ${to}`;
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

  const triggerLabel =
    activePreset === "custom"
      ? PRESET_LABELS.custom
      : PRESET_LABELS[activePreset];

  function applyRange(next: DateRange) {
    setParams({ dateFrom: next.dateFrom, dateTo: next.dateTo });
  }

  function selectPreset(preset: Exclude<DateRangePreset, "custom">) {
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

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Date range preset: ${triggerLabel}`}
          >
            {triggerLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => selectPreset("7d")}>
            {PRESET_LABELS["7d"]}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => selectPreset("30d")}>
            {PRESET_LABELS["30d"]}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => selectPreset("90d")}>
            {PRESET_LABELS["90d"]}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCalendarOpen(true)}>
            {PRESET_LABELS.custom}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Custom date range: ${formatRangeLabel(range)}`}
          >
            <CalendarIcon />
            <span className="hidden md:inline">{formatRangeLabel(range)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
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
