import { Suspense } from "react";

import { TeamsContent } from "@/components/teams/TeamsContent";
import { Skeleton } from "@/components/ui/skeleton";

// Server Component shell (Rule 60.7); TeamsContent reads the URL via nuqs, so
// it sits under Suspense for static prerender (Rule 60.12).
export default function TeamsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <TeamsContent />
    </Suspense>
  );
}
