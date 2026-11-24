"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import {
  PendingLinkRemovedSchema,
  PendingLinksPageSchema,
} from "@llm-usage-lens/shared";

import { Panel } from "@/components/display/Panel";
import { Button } from "@/components/ui/button";
import { ApiRequestError, fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: Design System - "Sync from LiteLLM", Not signed in yet (people known
// only from LiteLLM, read from GET /api/identities/pending-links; admin and
// org-admin can Remove one); Access Control - API routes (additions): 25 rows
// a page with an opaque cursor, DELETE { email, version }. The per-person
// Invite and Add user actions belong to unit INV2. The row schema names only
// what is shown, so an SSO reference in a payload is dropped on parse (S20);
// the route's own shape is the shared contract (agent decision, 2026-11-24).
const PATH = "/api/identities/pending-links";

type Item = z.infer<typeof PendingLinksPageSchema>["items"][number];

// Only the API's own error answer is shown; a parse or network failure would
// print schema internals (field names) on screen (Rule 50.6, S20).
const messageOf = (cause: unknown, fallback: string) =>
  cause instanceof ApiRequestError ? cause.message : fallback;

export function PendingLinksList({ canRemove }: { canRemove: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (after?: string) => {
    try {
      const url = after ? `${PATH}?cursor=${encodeURIComponent(after)}` : PATH;
      const page = await fetchApi(url, PendingLinksPageSchema);
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.cursor);
      setError(null);
    } catch (cause) {
      setError(messageOf(cause, "The list could not load."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    fetchApi(PATH, PendingLinksPageSchema)
      .then((page) => {
        if (!live) return;
        setItems(page.items);
        setCursor(page.cursor);
      })
      .catch((cause: unknown) => {
        if (live) {
          setError(messageOf(cause, "The list could not load."));
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  async function remove(item: Item) {
    try {
      await mutateApi(
        PATH,
        "DELETE",
        item.email
          ? { email: item.email, version: item.version }
          : { litellmUserId: item.litellmUserId, version: item.version },
        PendingLinkRemovedSchema,
      );
      await load();
    } catch (cause) {
      setError(messageOf(cause, "Could not remove."));
    }
  }

  return (
    <Panel
      title="Not signed in yet"
      boundaryTitle="the people not signed in yet"
      description="People known only from LiteLLM. They are linked when they sign in."
    >
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="text-muted-foreground text-sm">
          Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nobody is waiting to sign in.
        </p>
      ) : (
        <ul className="text-cell flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.litellmUserId}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="flex max-w-full min-w-0 flex-wrap gap-x-3">
                {item.email ? (
                  <span className="break-all">{item.email}</span>
                ) : null}
                <span className="text-muted-foreground font-mono break-all">
                  {item.litellmUserId}
                </span>
              </span>
              {canRemove ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Remove ${item.email ?? item.litellmUserId}`}
                  onClick={() => void remove(item)}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void load(cursor)}
        >
          Show more
        </Button>
      ) : null}
    </Panel>
  );
}
