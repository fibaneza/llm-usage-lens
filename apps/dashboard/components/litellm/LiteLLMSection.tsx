"use client";

import {
  useId,
  useLayoutEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";

import { Skeleton } from "@/components/ui/skeleton";

import { LiteLLMReportedBadge } from "./LiteLLMReportedBadge";
import { useIsClient } from "./use-is-client";

type LiteLLMSectionProps = {
  title: string;
  reported?: boolean;
  resetKey?: unknown;
  children: ReactNode;
};

// Suspense fallback that marks its section as loading. While loading the
// section is not yet a named region: it becomes one when its content (or its
// error alert) replaces this skeleton.
function Loading({
  setPending,
}: {
  setPending: Dispatch<SetStateAction<boolean>>;
}) {
  useLayoutEffect(() => {
    setPending(true);
    return () => setPending(false);
  }, [setPending]);
  return <Skeleton className="h-40 w-full" />;
}

// One page section: a labelled region with its own Suspense + ErrorBoundary so
// a failure never breaks the page (Rule 40.4, 60.12).
export function LiteLLMSection({
  title,
  reported = false,
  resetKey,
  children,
}: LiteLLMSectionProps) {
  const headingId = useId();
  const [pending, setPending] = useState(false);
  const isClient = useIsClient();

  return (
    <section
      aria-labelledby={pending ? undefined : headingId}
      aria-busy={pending}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {title}
        </h2>
        {reported ? <LiteLLMReportedBadge /> : null}
      </div>
      {isClient ? (
        <SectionBoundary
          title={title.toLowerCase()}
          resetKeys={[resetKey]}
          fallback={<Loading setPending={setPending} />}
        >
          {children}
        </SectionBoundary>
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </section>
  );
}

export function Unavailable() {
  return (
    <p className="text-muted-foreground py-6 text-sm">LiteLLM unavailable</p>
  );
}

export function NotConnected() {
  return (
    <p className="text-muted-foreground py-6 text-sm">
      This team is not connected to LiteLLM.
    </p>
  );
}

export function Empty({ children }: { children: string }) {
  return <p className="text-muted-foreground py-6 text-sm">{children}</p>;
}
