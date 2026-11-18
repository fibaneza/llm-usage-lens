import { redirect } from "next/navigation";

import { withSearchParams } from "@/lib/nav";

// Design System - Routes and redirects (D3, 2026-11-17): Organisation is the
// first tab of Management -> LiteLLM. A server redirect that keeps the query;
// the target page applies its own gate, so a caller who may not see it gets
// that page's 404.
export default async function OrganisationRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(
    withSearchParams(
      "/dashboard/manage/litellm/organisation",
      await searchParams,
    ),
  );
}
