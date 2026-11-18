import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { managementAccessFor } from "@/lib/manage-access";
import { withSearchParams } from "@/lib/nav";

import { LITELLM_AREA_TABS, liteLLMAreaTabHref } from "./litellm-area-tabs";

// Lands on the caller's first visible tab (Design System - LiteLLM area). All
// three tabs follow the one `litellm` flag, so the first is Organisation;
// anything else is the missing-page 404. The query (the date range) travels.
export default async function LiteLLMAreaIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await managementAccessFor(await auth())).litellm) notFound();
  const first = LITELLM_AREA_TABS[0];
  redirect(withSearchParams(liteLLMAreaTabHref(first.id), await searchParams));
}
