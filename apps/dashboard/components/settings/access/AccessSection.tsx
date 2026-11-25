import type { ReactNode } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { Skeleton } from "@/components/ui/skeleton";

// One Settings access section: anchor by slug, an h2, and its own boundary so a
// failing section never breaks the others (Rule 40.4, 60.12).
export function AccessSection({
  slug,
  heading,
  title,
  description,
  help,
  children,
}: {
  slug: string;
  heading: string;
  title: string;
  description?: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={slug}
      aria-labelledby={`${slug}-heading`}
      className="flex scroll-mt-20 flex-col gap-3"
    >
      <div className="flex max-w-[72ch] flex-col gap-1">
        {help ? (
          <div className="flex items-center gap-1">
            <h2 id={`${slug}-heading`} className="text-base font-semibold">
              {heading}
            </h2>
            {help}
          </div>
        ) : (
          <h2 id={`${slug}-heading`} className="text-base font-semibold">
            {heading}
          </h2>
        )}
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      <SectionBoundary
        title={title}
        fallback={<Skeleton className="h-40 w-full" />}
      >
        {children}
      </SectionBoundary>
    </section>
  );
}
