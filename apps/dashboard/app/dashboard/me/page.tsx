import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { MeContent } from "./MeContent";

// Server Component shell (Rule 60.7); the client boundary sits in MeContent,
// which reads the URL date range via nuqs and so sits under Suspense
// (Rule 60.12). The h1 comes from PageTitle (nav pageTitle "My usage").
export default function MePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <MeContent />
    </Suspense>
  );
}
