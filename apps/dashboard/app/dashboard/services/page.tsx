import { Suspense } from "react";

import { ServicesContent } from "@/components/services/ServicesContent";
import { Skeleton } from "@/components/ui/skeleton";
import { requireGlobalReader } from "@/lib/usage-access";

// Server Component shell (Rule 60.7); ServicesContent reads the URL via nuqs,
// so it sits under Suspense for static prerender (Rule 60.12). Usage routes
// 404 for non-global callers.
export default async function ServicesPage() {
  await requireGlobalReader();

  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ServicesContent />
    </Suspense>
  );
}
