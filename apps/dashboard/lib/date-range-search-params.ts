import { parseAsString } from "nuqs";

// nuqs parsers for the global date filter. The URL keys are `dateFrom`/`dateTo`
// as `yyyy-MM-dd` strings, matching the future `DateRangeQuerySchema` contract
// (Rule 20 — data-model conventions). Defined once here so the picker and any
// future server-side `createSearchParamsCache` consumer share one definition.
export const dateRangeSearchParams = {
  dateFrom: parseAsString,
  dateTo: parseAsString,
};

// The global date-filter URL keys, derived from the parser map so there is one
// source of truth (`withDateRange` below and the picker both rely on these).
const DATE_RANGE_KEYS = Object.keys(dateRangeSearchParams);

// Minimal structural type — satisfied by both `URLSearchParams` and Next's
// `ReadonlyURLSearchParams` (from `useSearchParams`), so this stays free of a
// next/navigation import.
type ReadableParams = Pick<URLSearchParams, "get">;

// Append the active global date-range params to a destination href so the filter
// survives navigation between pages (issue #75 — selecting a range then clicking
// another menu must not reset it). Only the global filter keys are carried
// forward; page-local params (tabs, sort) stay page-local.
export function withDateRange(href: string, params: ReadableParams): string {
  const carried = new URLSearchParams();
  for (const key of DATE_RANGE_KEYS) {
    const value = params.get(key);
    if (value) carried.set(key, value);
  }
  const query = carried.toString();
  if (!query) return href;
  return `${href}${href.includes("?") ? "&" : "?"}${query}`;
}
