import { Suspense } from "react";

import { RankingContent } from "@/components/ranking/RankingContent";
import { Skeleton } from "@/components/ui/skeleton";
import { requireGlobalReader } from "@/lib/usage-access";

// Server Component shell (Rule 60.7); the client boundary sits in
// RankingContent. It reads the URL (tab, model, date range) via nuqs
// (useSearchParams), so it sits under Suspense for static prerender
// (Rule 60.12). Usage routes 404 for non-global callers.
export default async function RankingPage() {
  await requireGlobalReader();

  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <RankingContent />
    </Suspense>
  );
}
