import { MODEL_KEYS, RANKING_TABS } from "@llm-usage-lens/shared";
import { parseAsStringLiteral } from "nuqs";

// nuqs parsers for the ranking page's URL state (Rule 40.5). The URL is
// untrusted: an unknown `tab` falls back to Departments and an unknown `model`
// to null, which the page treats as "all models" (parameter omitted). The tab
// stays in the URL even when it is the default, so every tab click is visible
// in the shareable link.
export const rankingSearchParams = {
  tab: parseAsStringLiteral(RANKING_TABS)
    .withDefault("departments")
    .withOptions({ clearOnDefault: false }),
  model: parseAsStringLiteral(MODEL_KEYS),
};
