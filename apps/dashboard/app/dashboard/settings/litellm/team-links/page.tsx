import { redirect } from "next/navigation";

import { withSearchParams } from "@/lib/nav";

// Design System - Routes and redirects (D3, 2026-11-17): this Settings
// sub-tab moved to Management -> LiteLLM. A server redirect that keeps the
// query; the target applies its own gate.
export default async function TeamLinksMovedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(
    withSearchParams("/dashboard/manage/litellm/teams", await searchParams),
  );
}
