"use client";

import { Download } from "lucide-react";
import { parseAsStringLiteral, useQueryStates } from "nuqs";
import type { ReactNode } from "react";

import { AuditSection } from "@/components/litellm/AuditSection";
import { LiteLLMSection } from "@/components/litellm/LiteLLMSection";
import { PageHeader } from "@/components/layout/PageHeader";
import { SORT_PARAMS } from "@/components/tables/SortableHeader";
import { Button } from "@/components/ui/button";
import { withBasePath } from "@/lib/base-path";

const SOURCES = ["app", "gateway"] as const;
type AuditSource = (typeof SOURCES)[number];

const LABELS: Record<AuditSource, string> = { app: "App", gateway: "Gateway" };

const SOURCE_PARAMS = {
  source: parseAsStringLiteral(SOURCES),
  ...SORT_PARAMS,
};

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
  const [params, setParams] = useQueryStates(SOURCE_PARAMS);
  const requested = params.source;
  const fallback = sources[0];
  const selected: AuditSource | undefined =
    requested !== null && sources.includes(requested) ? requested : fallback;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        description="Who changed what, in the dashboard and in the LiteLLM gateway."
        actions={
          sources.includes("app") ? (
            <Button asChild variant="outline" size="sm">
              <a href={withBasePath("/api/access-review")} download>
                <Download aria-hidden />
                Export access review (CSV)
              </a>
            </Button>
          ) : undefined
        }
      >
        {sources.length > 1 ? (
          <div role="group" aria-label="Audit source" className="flex gap-1">
            {sources.map((source) => (
              <Button
                key={source}
                variant={source === selected ? "default" : "outline"}
                size="sm"
                aria-pressed={source === selected}
                onClick={() =>
                  void setParams({ source, sort: null, dir: null })
                }
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
