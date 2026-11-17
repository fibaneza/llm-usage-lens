"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import type { ReactNode } from "react";

import { AuditSection } from "@/components/litellm/AuditSection";
import { LiteLLMSection } from "@/components/litellm/LiteLLMSection";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";

const SOURCES = ["app", "gateway"] as const;
type AuditSource = (typeof SOURCES)[number];

const LABELS: Record<AuditSource, string> = { app: "App", gateway: "Gateway" };

const sourceParser = parseAsStringLiteral(SOURCES);

// Design System - Management pages, Audit: one page, a source filter shown as
// a segmented toggle (nuqs `source`) only when the caller may read both; a
// source it may not read is never offered or selected. App is the dashboard
// audit sections (server-rendered by the page), Gateway is LiteLLM's audit.
export function AuditPageContent({
  sources,
  app,
}: {
  sources: readonly AuditSource[];
  app?: ReactNode;
}) {
  const [requested, setRequested] = useQueryState("source", sourceParser);
  const fallback = sources[0];
  const selected: AuditSource | undefined =
    requested !== null && sources.includes(requested) ? requested : fallback;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="Who changed what, in the dashboard and in the LiteLLM gateway.">
        {sources.length > 1 ? (
          <div role="group" aria-label="Audit source" className="flex gap-1">
            {sources.map((source) => (
              <Button
                key={source}
                variant={source === selected ? "default" : "outline"}
                size="sm"
                aria-pressed={source === selected}
                onClick={() => void setRequested(source)}
              >
                {LABELS[source]}
              </Button>
            ))}
          </div>
        ) : null}
      </PageHeader>
      {selected === "app" ? app : null}
      {selected === "gateway" ? (
        <LiteLLMSection title="LiteLLM audit">
          <AuditSection />
        </LiteLLMSection>
      ) : null}
    </div>
  );
}
