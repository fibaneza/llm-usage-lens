import { redirect } from "next/navigation";
import { Suspense } from "react";

import { auth } from "@/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { OverviewContent } from "@/components/overview/OverviewContent";
import { Skeleton } from "@/components/ui/skeleton";
import { scopeFor } from "@/lib/api/scoped-rollups";
import { landingPathFor } from "@/lib/nav";

// Server Component shell (Rule 60.7); the client boundary sits in
// OverviewContent. It reads the URL date range via nuqs (useSearchParams), so
// it sits under Suspense for static prerender (Rule 60.12).
// /dashboard is the sign-in callback target: a non-global caller is sent to
// their landing page and never sees the Overview (Access Control - Navigation
// and landing by role). The scope is read per request, never cached
// (Rule 60.10).
export default async function OverviewPage() {
  const session = await auth();
  if (!session) redirect("/sign-in");
  const scope = await scopeFor(session, []);
  if (!scope.global) redirect(landingPathFor(scope));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="Bedrock spend, usage and trends across the organisation for the selected period." />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <OverviewContent />
      </Suspense>
    </div>
  );
}
