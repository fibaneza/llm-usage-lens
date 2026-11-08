import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { UsersContent } from "@/components/users/UsersContent";

// Server Component shell (Rule 60.7); UsersContent reads the URL via nuqs,
// so it sits under Suspense for static prerender (Rule 60.12).
export default function UsersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <UsersContent />
    </Suspense>
  );
}
