import { Suspense } from "react";

import { ServicesContent } from "@/components/services/ServicesContent";
import { Skeleton } from "@/components/ui/skeleton";

// Server Component shell (Rule 60.7); ServicesContent reads the URL via nuqs,
// so it sits under Suspense for static prerender (Rule 60.12).
export default function ServicesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ServicesContent />
    </Suspense>
  );
}
