import type { ReactNode } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { Skeleton } from "@/components/ui/skeleton";

// One Settings section: an h2 and its own Suspense + ErrorBoundary so a failing
// section never breaks the page (Rule 40.4, 60.12).
export function SettingsSection({
  heading,
  title,
  children,
}: {
  heading: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{heading}</h2>
      <SectionBoundary
        title={title}
        fallback={<Skeleton className="h-40 w-full" />}
      >
        {children}
      </SectionBoundary>
    </section>
  );
}
