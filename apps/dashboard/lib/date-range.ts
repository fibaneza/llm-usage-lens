// Global date-filter logic. All arithmetic is in UTC calendar days to match the
// DynamoDB `DAILY#{YYYY-MM-DD}` keys (Rule 20.1 — UTC everywhere) and the future
// `DateRangeQuerySchema` contract (`dateFrom`/`dateTo` as `yyyy-MM-dd` strings).
// Custom ranges clamp to a 90-day max span (Rule 20.8). Parsing, formatting, and
// day differences are computed purely in UTC (not via date-fns' local-timezone
// helpers) so a non-UTC host can't shift a day boundary and, e.g., let a custom
// range exceed the 90-day cap.

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

// Maximum inclusive span for a custom range (Rule 20.8).
export const MAX_RANGE_DAYS = 90;

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

export function parseDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid yyyy-MM-dd date: ${value}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
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
  return diffUtcDays(parseDay(range.dateFrom), parseDay(range.dateTo)) + 1;
}

// Clamp a custom range to the 90-day max span and normalize endpoint order.
// If the span exceeds the cap, `dateFrom` is pulled forward toward `dateTo`.
export function clampCustomRange(range: DateRange): DateRange {
  let from = parseDay(range.dateFrom);
  let to = parseDay(range.dateTo);

  if (from > to) {
    [from, to] = [to, from];
  }

  const span = diffUtcDays(from, to) + 1;
  if (span > MAX_RANGE_DAYS) {
    from = addUtcDays(to, -(MAX_RANGE_DAYS - 1));
  }

  return { dateFrom: formatDay(from), dateTo: formatDay(to) };
}
