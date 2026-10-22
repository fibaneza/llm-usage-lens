import { z } from "zod";

import { ModelKeySchema } from "../models";
import { AccountIdSchema, UtcDaySchema, parseUtcDayMs } from "./primitives";

// API query-param schemas.
// Source: docs/specs/2026-05-15-data-model.md — "Zod Validation Schemas" and
// "API Routes". Date params are YYYY-MM-DD UTC calendar days (Rule 20.1);
// custom ranges are capped at an inclusive 90-day span (Rule 20.8); the
// dashboard's date-range helpers re-export this constant.

export const MAX_RANGE_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type DateRangeFields = {
  dateFrom: string;
  dateTo: string;
};

// Inclusive day count (1 for a single day). Both endpoints are UTC midnight,
// so the epoch gap is an exact multiple of a day. NaN when either endpoint is
// invalid — the field-level UtcDaySchema already reports that case.
function inclusiveSpanDays({ dateFrom, dateTo }: DateRangeFields): number {
  const from = parseUtcDayMs(dateFrom);
  const to = parseUtcDayMs(dateTo);
  if (from === null || to === null) return Number.NaN;
  return Math.round((to - from) / MS_PER_DAY) + 1;
}

function isOrderedRange(range: DateRangeFields): boolean {
  const span = inclusiveSpanDays(range);
  return Number.isNaN(span) || span >= 1;
}

function isWithinMaxSpan(range: DateRangeFields): boolean {
  const span = inclusiveSpanDays(range);
  return Number.isNaN(span) || span <= MAX_RANGE_DAYS;
}

const ORDERED_RANGE_ISSUE = {
  message: "dateFrom must be on or before dateTo",
  path: ["dateFrom"],
};

const MAX_SPAN_ISSUE = {
  message: `Date range must span at most ${MAX_RANGE_DAYS} days`,
  path: ["dateTo"],
};

export const DateRangeQuerySchema = z
  .object({
    dateFrom: UtcDaySchema,
    dateTo: UtcDaySchema,
    accountId: AccountIdSchema.optional(),
  })
  .refine(isOrderedRange, ORDERED_RANGE_ISSUE)
  .refine(isWithinMaxSpan, MAX_SPAN_ISSUE);

export type DateRangeQuery = z.infer<typeof DateRangeQuerySchema>;

export const RANKING_TABS = [
  "departments",
  "teams",
  "services",
  "users",
] as const;

export const RankingTabSchema = z.enum(RANKING_TABS);

export type RankingTab = z.infer<typeof RankingTabSchema>;

export const RANKING_SORT_FIELDS = [
  "cost",
  "inputTokens",
  "outputTokens",
  "invocations",
] as const;

export const DEFAULT_RANKING_LIMIT = 10;
export const MAX_RANKING_LIMIT = 100;

export const RankingQuerySchema = z
  .object({
    dateFrom: UtcDaySchema,
    dateTo: UtcDaySchema,
    tab: RankingTabSchema,
    model: ModelKeySchema.optional(),
    sortBy: z.enum(RANKING_SORT_FIELDS).optional(),
    order: z.enum(["asc", "desc"]).default("desc"),
    // Query params arrive as strings — coerce before bounds-checking.
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_RANKING_LIMIT)
      .default(DEFAULT_RANKING_LIMIT),
  })
  .refine(isOrderedRange, ORDERED_RANGE_ISSUE)
  .refine(isWithinMaxSpan, MAX_SPAN_ISSUE);

export type RankingQuery = z.infer<typeof RankingQuerySchema>;

export const TeamsQuerySchema = z
  .object({
    dateFrom: UtcDaySchema,
    dateTo: UtcDaySchema,
    departmentId: z.string().min(1).optional(),
  })
  .refine(isOrderedRange, ORDERED_RANGE_ISSUE)
  .refine(isWithinMaxSpan, MAX_SPAN_ISSUE);

export type TeamsQuery = z.infer<typeof TeamsQuerySchema>;
