"use client";

import { IdentityLinkSchema } from "@llm-usage-lens/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchApi, mutateApi } from "@/lib/query/fetch-api";
import { requestErrorMessage } from "@/lib/query/request-error-message";

// Source: docs/specs/2026-11-10-access-control.md - "Usage-identity mapping
// rules (D27)": a rule SUGGESTS a link; the admin confirms each one (or all of
// one rule), which stores an exact alias and its claim through the existing
// link route (409 on a duplicate). Nothing is linked automatically.
const SUGGESTIONS_PATH = "/api/governance/identity-map-rules/suggestions";
const SUGGESTIONS_KEY = ["identity-map-rules", "suggestions"] as const;
// Data Model - DateRangeQuerySchema: the widest range is 90 inclusive days.
const RANGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SuggestionSchema = z.object({
  pattern: z.string(),
  usageKey: z.string(),
  email: z.string(),
  oid: z.string(),
});
type Suggestion = z.infer<typeof SuggestionSchema>;
const ResponseSchema = z.object({ items: z.array(SuggestionSchema) });

function utcRange(now: Date): { dateFrom: string; dateTo: string } {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return {
    dateFrom: day(now.getTime() - (RANGE_DAYS - 1) * MS_PER_DAY),
    dateTo: day(now.getTime()),
  };
}

async function confirmLink(suggestion: Suggestion): Promise<void> {
  const path = `/api/identities/${encodeURIComponent(suggestion.oid)}/links`;
  const link = await fetchApi(path, IdentityLinkSchema);
  const key = suggestion.usageKey;
  if (link.usageIdentities.includes(key) || link.aliases.includes(key)) return;
  await mutateApi(
    path,
    "PUT",
    {
      usageIdentities: link.usageIdentities,
      aliases: [...link.aliases, key],
      ...(link.litellmUserId ? { litellmUserId: link.litellmUserId } : {}),
      version: link.version,
    },
    IdentityLinkSchema,
  );
}

function groupByPattern(items: Suggestion[]): [string, Suggestion[]][] {
  const groups = new Map<string, Suggestion[]>();
  for (const item of items) {
    groups.set(item.pattern, [...(groups.get(item.pattern) ?? []), item]);
  }
  return [...groups];
}

export function IdentityLinkSuggestions({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [range] = useState(() => utcRange(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: [...SUGGESTIONS_KEY, range.dateFrom, range.dateTo],
    queryFn: () =>
      fetchApi(
        `${SUGGESTIONS_PATH}?dateFrom=${range.dateFrom}&dateTo=${range.dateTo}`,
        ResponseSchema,
      ),
  });

  // Sequential on purpose: a person's second key must read the link version
  // the first PUT produced. The first failure stops the run.
  async function confirm(batch: Suggestion[]) {
    setBusy(true);
    setError(null);
    try {
      for (const suggestion of batch) {
        try {
          await confirmLink(suggestion);
        } catch (e) {
          setError(
            `Could not link ${suggestion.usageKey}: ${requestErrorMessage(e)}`,
          );
          return;
        }
      }
    } finally {
      await queryClient.invalidateQueries({ queryKey: SUGGESTIONS_KEY });
      setBusy(false);
    }
  }

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {requestErrorMessage(query.error)}
      </p>
    );
  }

  const groups = groupByPattern(query.data.items);

  return (
    <section
      aria-labelledby="identity-suggestions-title"
      className="flex max-w-[72ch] flex-col gap-4"
    >
      <h3 id="identity-suggestions-title" className="text-base font-semibold">
        Suggested links
      </h3>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">No suggested links.</p>
      ) : (
        groups.map(([pattern, items]) => {
          const headingId = `suggestions-${pattern}`;
          return (
            <div
              key={pattern}
              role="group"
              aria-labelledby={headingId}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-3">
                <h4 id={headingId} className="text-sm font-medium">
                  Rule <code className="font-mono">{pattern}</code>
                </h4>
                {isAdmin ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`Confirm all for ${pattern}`}
                    onClick={() => void confirm(items)}
                  >
                    Confirm all
                  </Button>
                ) : null}
              </div>
              <ul className="flex flex-col divide-y">
                {items.map((item) => (
                  <li
                    key={item.usageKey}
                    className="flex items-center justify-between gap-3 py-1.5 text-sm"
                  >
                    <span className="flex flex-wrap items-center gap-x-2">
                      <span className="font-mono">{item.usageKey}</span>
                      <span className="text-muted-foreground">maps to</span>
                      <span>{item.email}</span>
                    </span>
                    {isAdmin ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={`Confirm link ${item.usageKey}`}
                        onClick={() => void confirm([item])}
                      >
                        Confirm
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
