"use client";

import {
  DirectoryPageSchema,
  IdentityLinkSchema,
} from "@llm-usage-lens/shared";
import type { DirectoryRow, IdentityLink } from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { KeyboardEvent } from "react";

import { accessErrorMessage } from "@/components/settings/access/access-error-message";
import { idPath } from "@/components/settings/access/access-queries";
import {
  FormError,
  FormField,
  FormStatus,
} from "@/components/settings/access/form-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LITELLM_AREA_HREF } from "@/lib/nav";
import { fetchApi, mutateApi } from "@/lib/query/fetch-api";
import { sectionData } from "@/lib/query/section-data";

// Source: docs/specs/2026-11-10-access-control.md - "Identity links (shared
// contract)" (usageIdentities[], aliases[] and litellmUserId per oid;
// internal-admin edits, the auditor reads; a key belongs to one person - a
// duplicate answers 409; links show a person their own usage and never grant
// access), "Canonical usage identity" (keys are exact, lower-case), "Data model
// additions" (version 0 = no link yet; a PUT with version 0 creates).
type KeyList = "usageIdentities" | "aliases";
const LIST_LABELS: Record<KeyList, { heading: string; singular: string }> = {
  usageIdentities: { heading: "Usage identities", singular: "usage identity" },
  aliases: { heading: "Aliases", singular: "alias" },
};

function KeyEditor({
  list,
  keys,
  canEdit,
  onAdd,
  onRemove,
}: {
  list: KeyList;
  keys: string[];
  canEdit: boolean;
  onAdd: (list: KeyList, key: string) => string | null;
  onRemove: (list: KeyList, key: string) => void;
}) {
  const { heading, singular } = LIST_LABELS[list];
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();

  function add() {
    const problem = onAdd(list, value);
    setError(problem ?? undefined);
    if (problem === null) setValue("");
  }

  return (
    <div className="flex max-w-[72ch] flex-col gap-2">
      <h3 className="text-sm font-medium">{heading}</h3>
      {keys.length === 0 ? (
        <p className="text-muted-foreground text-sm">None yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {keys.map((key) => (
            <li key={key} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 font-mono break-all">{key}</span>
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${singular} ${key}`}
                  onClick={() => onRemove(list, key)}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <FormField label={`New ${singular}`} error={error}>
              {(props) => (
                <Input
                  {...props}
                  autoComplete="off"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      add();
                    }
                  }}
                />
              )}
            </FormField>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus aria-hidden />
            {`Add ${singular}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function LinksEditor({
  link,
  canEdit,
}: {
  link: IdentityLink;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [lists, setLists] = useState({
    usageIdentities: link.usageIdentities,
    aliases: link.aliases,
  });
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      return mutateApi(
        `/api/identities/${idPath(link.oid)}/links`,
        "PUT",
        {
          usageIdentities: lists.usageIdentities,
          aliases: lists.aliases,
          ...(link.litellmUserId === undefined
            ? {}
            : { litellmUserId: link.litellmUserId }),
          version: link.version,
        },
        IdentityLinkSchema,
      );
    },
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({
        queryKey: ["access", "identity-links", link.oid],
      });
    },
  });

  function add(list: KeyList, raw: string): string | null {
    const key = raw.trim().toLowerCase();
    if (key === "") return "Enter a key to add";
    if (lists.usageIdentities.includes(key) || lists.aliases.includes(key)) {
      return "That key is already listed";
    }
    setLists({ ...lists, [list]: [...lists[list], key] });
    setSaved(false);
    return null;
  }
  function remove(list: KeyList, key: string) {
    setLists({ ...lists, [list]: lists[list].filter((k) => k !== key) });
    setSaved(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <KeyEditor
        list="usageIdentities"
        keys={lists.usageIdentities}
        canEdit={canEdit}
        onAdd={add}
        onRemove={remove}
      />
      <KeyEditor
        list="aliases"
        keys={lists.aliases}
        canEdit={canEdit}
        onAdd={add}
        onRemove={remove}
      />
      {canEdit ? (
        <>
          <LiteLLMUserIdReadOnly litellmUserId={link.litellmUserId} />
          <div>
            <Button
              type="button"
              size="sm"
              disabled={save.isPending}
              onClick={() => {
                setSaved(false);
                save.mutate();
              }}
            >
              Save links
            </Button>
          </div>
          {save.isError ? (
            <FormError>{accessErrorMessage(save.error)}</FormError>
          ) : null}
          {saved ? <FormStatus>Saved.</FormStatus> : null}
        </>
      ) : (
        <LiteLLMUserIdReadOnly litellmUserId={link.litellmUserId} />
      )}
    </div>
  );
}

// Access Control spec - LiteLLM user links (M3 review B1): the id changes only
// through PUT /api/identities/[oid]/litellm-link, so it is shown read-only here.
function LiteLLMUserIdReadOnly({
  litellmUserId,
}: {
  litellmUserId: string | undefined;
}) {
  return (
    <p className="text-sm">
      <span className="font-medium">LiteLLM user ID: </span>
      <span className="font-mono">{litellmUserId ?? "None"}</span>
      {" - "}
      <Link
        href={`${LITELLM_AREA_HREF}/users`}
        className="text-primary underline"
      >
        Link in Management, LiteLLM, LiteLLM users
      </Link>
    </p>
  );
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 400;
const MAX_RESULTS = 10;

function directoryLabel(row: DirectoryRow): string {
  const name = row.displayName ?? row.email ?? row.oid;
  return row.email && row.displayName ? `${name} (${row.email})` : name;
}

// Design System - Settings, Identity pickers (D-ST2): a search box over
// GET /api/identities/directory?q= (2+ characters, debounced, 10 results),
// never the full list; the editor appears after a pick.
export function IdentityLinksSection({ canEdit }: { canEdit: boolean }) {
  const listId = useId();
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [oid, setOid] = useState<string | undefined>();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const searching = debounced.length >= MIN_QUERY_LENGTH;
  const directory = useQuery({
    queryKey: ["access", "identity-directory", debounced],
    queryFn: () =>
      fetchApi(
        `/api/identities/directory?q=${encodeURIComponent(debounced)}`,
        DirectoryPageSchema,
      ),
    enabled: searching,
  });
  const results = searching
    ? (directory.data?.items.slice(0, MAX_RESULTS) ?? [])
    : [];
  const showList = open && searching && directory.data !== undefined;

  const linkQuery = useQuery({
    queryKey: ["access", "identity-links", oid],
    queryFn: () =>
      fetchApi(
        `/api/identities/${idPath(oid ?? "")}/links`,
        IdentityLinkSchema,
      ),
    enabled: oid !== undefined,
  });
  const link = sectionData(linkQuery);

  function pick(row: DirectoryRow) {
    setOid(row.oid);
    setText(directoryLabel(row));
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" && results.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp" && results.length > 0) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && showList && active >= 0) {
      e.preventDefault();
      const row = results[active];
      if (row) pick(row);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-[72ch]">
        <FormField
          label="Person"
          hint="Type at least 2 characters of a name or email."
        >
          {(props) => (
            <Input
              {...props}
              role="combobox"
              aria-expanded={showList}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                active >= 0 ? `${listId}-${active}` : undefined
              }
              autoComplete="off"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setOpen(true);
                setActive(-1);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
            />
          )}
        </FormField>
        {showList ? (
          results.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-sm">
              No people match.
            </p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label="People"
              className="bg-popover mt-1 flex flex-col rounded-md border shadow-md"
            >
              {results.map((row, index) => (
                <li
                  key={row.oid}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className="data-[active=true]:bg-accent cursor-pointer px-3 py-2 text-sm break-words"
                  data-active={index === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(row)}
                >
                  {directoryLabel(row)}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
      {oid === undefined ? null : link === undefined ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <LinksEditor key={oid} link={link} canEdit={canEdit} />
      )}
    </div>
  );
}
