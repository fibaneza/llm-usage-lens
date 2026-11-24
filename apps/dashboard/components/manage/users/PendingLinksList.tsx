"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import {
  PendingLinkRemovedSchema,
  PendingLinksPageSchema,
} from "@llm-usage-lens/shared";

import { Panel } from "@/components/display/Panel";
import { AddUserDialog } from "@/components/manage/users/AddUserDialog";
import { TeamPickerDialog } from "@/components/manage/users/TeamPickerDialog";
import type {
  AccessViewer,
  StepUpActions,
} from "@/components/settings/access/types";
import { Button } from "@/components/ui/button";
import type { AddUserSteps } from "@/lib/auth/add-user-steps";
import { ApiRequestError, fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: Design System - "Sync from LiteLLM", Not signed in yet (people known
// only from LiteLLM, read from GET /api/identities/pending-links; admin and
// org-admin can Remove one); Access Control - API routes (additions): 25 rows
// a page with an opaque cursor, DELETE { email, version }. Unit INV2 (Design
// System - Users, "Not signed in yet"; Access Control - SM6, SM8): with SSO the
// row offers Invite; without SSO also Add user (email filled in, internal-admin)
// and the hint "Joins at first SSO sign-in". The page passes the sign-in mode
// as a flag; this component never reads the Entra variable (T-SM5). The row schema names only
// what is shown, so an SSO reference in a payload is dropped on parse (S20);
// the route's own shape is the shared contract (agent decision, 2026-11-24).
const PATH = "/api/identities/pending-links";

type Item = z.infer<typeof PendingLinksPageSchema>["items"][number];

// Only the API's own error answer is shown; a parse or network failure would
// print schema internals (field names) on screen (Rule 50.6, S20).
const messageOf = (cause: unknown, fallback: string) =>
  cause instanceof ApiRequestError ? cause.message : fallback;

type Placing =
  | { kind: "invite"; email: string }
  | { kind: "add-user"; email: string }
  | null;

export function PendingLinksList({
  canRemove,
  steps,
  sso = true,
  authMethod,
  stepUp,
}: {
  canRemove: boolean;
  steps?: AddUserSteps;
  sso?: boolean;
  authMethod?: AccessViewer["authMethod"];
  stepUp?: StepUpActions;
}) {
  const [placing, setPlacing] = useState<Placing>(null);
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
              <span className="flex flex-wrap items-center gap-2">
                {item.email && steps?.team ? (
                  <span className="flex flex-col items-start gap-0.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Invite ${item.email}`}
                      onClick={() =>
                        item.email &&
                        setPlacing({ kind: "invite", email: item.email })
                      }
                    >
                      Invite
                    </Button>
                    {sso ? null : (
                      <span className="text-muted-foreground text-xs">
                        Joins at first SSO sign-in
                      </span>
                    )}
                  </span>
                ) : null}
                {item.email &&
                !sso &&
                steps?.password &&
                authMethod &&
                stepUp ? (
                  <span className="flex flex-col items-start gap-0.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Add user ${item.email}`}
                      onClick={() =>
                        item.email &&
                        setPlacing({ kind: "add-user", email: item.email })
                      }
                    >
                      Add user
                    </Button>
                    <span className="text-muted-foreground text-xs">
                      Add them as a user to let them sign in
                    </span>
                  </span>
                ) : null}
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
              </span>
            </li>
          ))}
        </ul>
      )}
      {placing?.kind === "invite" ? (
        <TeamPickerDialog
          action={{ kind: "invite", email: placing.email }}
          personName={placing.email}
          onClose={() => setPlacing(null)}
          onDone={() => {
            setPlacing(null);
            void load();
          }}
        />
      ) : null}
      {placing?.kind === "add-user" && steps && authMethod && stepUp ? (
        <AddUserDialog
          steps={steps}
          authMethod={authMethod}
          stepUp={stepUp}
          initialEmail={placing.email}
          onClose={() => setPlacing(null)}
          onWritten={() => void load()}
        />
      ) : null}
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
