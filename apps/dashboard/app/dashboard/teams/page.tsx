import { Suspense } from "react";

import { TeamsContent } from "@/components/teams/TeamsContent";
import { Skeleton } from "@/components/ui/skeleton";
import { requireGlobalReader } from "@/lib/usage-access";

// Server Component shell (Rule 60.7); TeamsContent reads the URL via nuqs, so
// it sits under Suspense for static prerender (Rule 60.12). Usage routes 404
// for non-global callers.
export default async function TeamsPage() {
  await requireGlobalReader();

  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <TeamsContent />
    </Suspense>
  );
}
