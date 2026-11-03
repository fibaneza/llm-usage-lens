// Global date-filter logic. All arithmetic is in UTC calendar days to match the
// DynamoDB `DAILY#{YYYY-MM-DD}` keys (Rule 20.1 — UTC everywhere) and the future
// `DateRangeQuerySchema` contract (`dateFrom`/`dateTo` as `yyyy-MM-dd` strings).
// Custom ranges clamp to a 90-day max span (Rule 20.8). Parsing, formatting, and
// day differences are computed purely in UTC (not via date-fns' local-timezone
// helpers) so a non-UTC host can't shift a day boundary and, e.g., let a custom
// range exceed the 90-day cap.

import { MAX_RANGE_DAYS } from "@bedrock-usage/shared";

export const DATE_RANGE_PRESETS = ["7d", "30d", "90d", "custom"] as const;

export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

// A resolved range, inclusive of both endpoints, as `yyyy-MM-dd` UTC day strings.
export type DateRange = {
  dateFrom: string;
  dateTo: string;
};

export const DATE_FORMAT = "yyyy-MM-dd";

// Span limits are inclusive day counts: a 30-day preset spans 30 calendar days
// (today and the 29 prior), so the difference between endpoints is `days - 1`.
const PRESET_DAYS: Record<Exclude<DateRangePreset, "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const DEFAULT_PRESET: Exclude<DateRangePreset, "custom"> = "30d";

// Single source of the 90-day cap (Rule 20.8) lives in the shared query schema.
export { MAX_RANGE_DAYS };

// Today as a UTC calendar day with the clock zeroed, so the same instant maps to
// the same `yyyy-MM-dd` regardless of the host timezone.
function utcToday(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function addUtcDays(day: Date, amount: number): Date {
  return new Date(
    Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate() + amount,
    ),
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole UTC calendar days from `from` to `to`. Both arguments are UTC-midnight
// Dates (produced here), so the epoch gap is an exact multiple of a day — no
// DST or host-timezone drift.
function diffUtcDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function formatDay(day: Date): string {
  const year = day.getUTCFullYear().toString().padStart(4, "0");
  const month = (day.getUTCMonth() + 1).toString().padStart(2, "0");
  const date = day.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${date}`;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Strict `yyyy-MM-dd` parse to a UTC-midnight Date. Returns undefined for
// anything malformed or non-existent (e.g. 2026-02-30), since callers feed it
// untrusted URL values.
export function parseDay(value: string): Date | undefined {
  if (!DAY_PATTERN.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return undefined;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime()) || formatDay(parsed) !== value) {
    return undefined;
  }
  return parsed;
}

// For values already validated (a `DateRange` produced by this module).
export function requireDay(value: string): Date {
  const parsed = parseDay(value);
  if (parsed === undefined) {
    throw new Error(`Invalid yyyy-MM-dd date: ${value}`);
  }
  return parsed;
}

// Resolve untrusted URL endpoints to a safe range: unparseable input falls back
// to the default preset; otherwise order is normalised and the 90-day cap applied.
export function resolveUrlRange(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  now: Date = new Date(),
): DateRange {
  if (
    !dateFrom ||
    !dateTo ||
    parseDay(dateFrom) === undefined ||
    parseDay(dateTo) === undefined
  ) {
    return defaultDateRange(now);
  }
  return clampCustomRange({ dateFrom, dateTo });
}

// Resolve a non-custom preset to a concrete `{ dateFrom, dateTo }`, with `dateTo`
// pinned to today (UTC). Defaults to the 30-day preset for `custom`/unknown.
export function resolvePreset(
  preset: DateRangePreset,
  now: Date = new Date(),
): DateRange {
  const today = utcToday(now);
  const days =
    preset === "custom" ? PRESET_DAYS[DEFAULT_PRESET] : PRESET_DAYS[preset];
  const from = addUtcDays(today, -(days - 1));

  return { dateFrom: formatDay(from), dateTo: formatDay(today) };
}

export function defaultDateRange(now: Date = new Date()): DateRange {
  return resolvePreset(DEFAULT_PRESET, now);
}

// Derive which preset a concrete range matches. A range matches a preset when its
// `dateTo` is today and its inclusive span equals the preset's day count;
// anything else is `custom`.
export function presetForRange(
  range: DateRange,
  now: Date = new Date(),
): DateRangePreset {
  const today = formatDay(utcToday(now));
  if (range.dateTo !== today) return "custom";

  const span = inclusiveSpanDays(range);
  for (const preset of ["7d", "30d", "90d"] as const) {
    if (span === PRESET_DAYS[preset]) return preset;
  }
  return "custom";
}

// Inclusive day count between the two endpoints (1 for a single day).
export function inclusiveSpanDays(range: DateRange): number {
  return diffUtcDays(requireDay(range.dateFrom), requireDay(range.dateTo)) + 1;
}

// The period immediately before `range`: the same inclusive length, ending the
// day before `dateFrom`. Used by the overview DeltaBadge comparison (Phase 4.1).
export function previousRange(range: DateRange): DateRange {
  const from = requireDay(range.dateFrom);
  const length = inclusiveSpanDays(range);
  const previousTo = addUtcDays(from, -1);

  return {
    dateFrom: formatDay(addUtcDays(previousTo, -(length - 1))),
    dateTo: formatDay(previousTo),
  };
}

// Clamp a custom range to the 90-day max span and normalize endpoint order.
// If the span exceeds the cap, `dateFrom` is pulled forward toward `dateTo`.
export function clampCustomRange(range: DateRange): DateRange {
  let from = requireDay(range.dateFrom);
  let to = requireDay(range.dateTo);

  if (from > to) {
    [from, to] = [to, from];
  }

  const span = diffUtcDays(from, to) + 1;
  if (span > MAX_RANGE_DAYS) {
    from = addUtcDays(to, -(MAX_RANGE_DAYS - 1));
  }

  return { dateFrom: formatDay(from), dateTo: formatDay(to) };
}

// URL days are UTC calendar days (Rule 20.1) but react-day-picker and date-fns
// work in local days; convert at that boundary so a non-UTC host never shifts a
// day. date-fns stays display-only (design-system spec). Callers pass an
// already-validated YYYY-MM-DD string.
export function toLocalDay(day: string): Date {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

export function fromLocalDay(day: Date): string {
  const year = day.getFullYear().toString().padStart(4, "0");
  const month = (day.getMonth() + 1).toString().padStart(2, "0");
  const date = day.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${date}`;
}
