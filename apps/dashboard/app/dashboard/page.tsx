import { Suspense } from "react";

import { OverviewContent } from "@/components/overview/OverviewContent";
import { Skeleton } from "@/components/ui/skeleton";

// Server Component shell (Rule 60.7); the client boundary sits in
// OverviewContent. It reads the URL date range via nuqs (useSearchParams), so
// it sits under Suspense for static prerender (Rule 60.12).
export default function OverviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <OverviewContent />
    </Suspense>
  );
}
