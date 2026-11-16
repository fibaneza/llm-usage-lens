import { redirect } from "next/navigation";
import { Suspense } from "react";

import { auth } from "@/auth";
import { OverviewContent } from "@/components/overview/OverviewContent";
import { Skeleton } from "@/components/ui/skeleton";
import { scopeFor } from "@/lib/api/scoped-rollups";
import { landingPathFor } from "@/lib/nav";
import { scopeNoticeFor } from "@/lib/scope-labels";

// Server Component shell (Rule 60.7); the client boundary sits in
// OverviewContent. It reads the URL date range via nuqs (useSearchParams), so
// it sits under Suspense for static prerender (Rule 60.12).
// Role-aware landing (implementation-phases Phase 4R.5; orchestrator decision
// 2026-11-16): a non-global caller is sent to their landing page unless they
// asked for the Overview explicitly (?view=overview, the scoped nav link).
// The scope is read per request, never cached (Rule 60.10).
export default async function OverviewPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect("/sign-in");
  const scope = await scopeFor(session, []);
  const view = (await searchParams)?.view;
  if (!scope.global && view !== "overview") redirect(landingPathFor(scope));
  const notice = scopeNoticeFor(scope);

  return (
    <div className="flex flex-col gap-4">
      {notice === null ? null : (
        <p className="text-muted-foreground max-w-[72ch] text-sm">{notice}</p>
      )}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <OverviewContent />
      </Suspense>
    </div>
  );
}
