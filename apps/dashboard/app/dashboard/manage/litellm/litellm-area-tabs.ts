import { LITELLM_AREA_HREF } from "@/lib/nav";

// Design System - Management pages, LiteLLM area (D2, 2026-11-17): the three
// route tabs of Management -> LiteLLM. All three follow the one `litellm`
// flag (admin, org-admin, auditor read-only), so there is no per-tab filter.
export const LITELLM_AREA_TABS = [
  { id: "organisation", label: "Organisation" },
  { id: "teams", label: "LiteLLM teams" },
  { id: "users", label: "LiteLLM users" },
] as const;

export type LiteLLMAreaTabId = (typeof LITELLM_AREA_TABS)[number]["id"];

export function liteLLMAreaTabHref(id: LiteLLMAreaTabId): string {
  return `${LITELLM_AREA_HREF}/${id}`;
}
