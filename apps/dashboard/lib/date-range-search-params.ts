import { parseAsString } from "nuqs";

// nuqs parsers for the global date filter. The URL keys are `dateFrom`/`dateTo`
// as `yyyy-MM-dd` strings, matching the future `DateRangeQuerySchema` contract
// (Rule 20 — data-model conventions). Defined once here so the picker and any
// future server-side `createSearchParamsCache` consumer share one definition.
export const dateRangeSearchParams = {
  dateFrom: parseAsString,
  dateTo: parseAsString,
};
