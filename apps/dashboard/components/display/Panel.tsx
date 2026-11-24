"use client";

import { useId, type ReactNode } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { cn } from "@/lib/utils";

type PanelProps = {
  id?: string;
  title: string;
  headingLevel?: 2 | 3;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  // Names the section in the "Couldn't load <title>." error (SectionBoundary).
  boundaryTitle: string;
  skeleton?: ReactNode;
  resetKeys?: readonly unknown[];
  onReset?: () => void;
  busy?: boolean;
  // Renders the body without padding so a table fills the panel edge to edge.
  flush?: boolean;
  className?: string;
  children: ReactNode;
};

// Design System -- Component Inventory, `Panel`: the one titled section of
// the compact workspace. A card-surface region named by its heading, with its
// own Suspense + ErrorBoundary (Rule 40.4, 60.12).
export function Panel({
  id,
  title,
  headingLevel = 2,
  description,
  badge,
  actions,
  boundaryTitle,
  skeleton,
  resetKeys,
  onReset,
  busy = false,
  flush = false,
  className,
  children,
}: PanelProps) {
  const headingId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      aria-busy={busy ? true : undefined}
      data-slot="card"
      className={cn(
        "bg-card text-card-foreground rounded-card flex min-w-0 flex-col gap-3 border py-4",
        className,
      )}
    >
      <div
        data-slot="card-header"
        className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Heading
              id={headingId}
              data-slot="card-title"
              className={cn(
                "font-semibold",
                headingLevel === 3 ? "text-sm" : "text-base",
              )}
            >
              {title}
            </Heading>
            {badge}
          </div>
          {description ? (
            <div className="text-cell text-muted-foreground max-w-[72ch]">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      <div
        data-slot="card-content"
        className={cn("min-w-0", flush ? undefined : "px-4")}
      >
        <SectionBoundary
          title={boundaryTitle}
          fallback={skeleton}
          resetKeys={resetKeys}
          onRetry={onReset}
        >
          {children}
        </SectionBoundary>
      </div>
    </section>
  );
}
