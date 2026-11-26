"use client";

import {
  ConnectionTestResultSchema,
  LiteLLMConnectionStatusSchema,
} from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";

import { PanelSkeleton } from "@/components/settings/litellm-panel/PanelSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: docs/specs/2026-11-10-litellm.md — "Page and Settings" and "Security
// architecture" item 6: the Admin panel shows the connection URL, the edition
// (read-only) and whether the service key is configured, plus a connection
// test. There is no input for the key and its value is never fetched or shown.

// Unknown fields in a response are dropped, never rendered.
const StatusSchema = LiteLLMConnectionStatusSchema.strip();
const STATUS_KEY = ["litellm", "connection"] as const;

function BaseUrlForm({
  stored,
  value,
  onValueChange,
  version,
}: {
  stored: string | null;
  value: string;
  onValueChange: (next: string) => void;
  version: number;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      mutateApi(
        "/api/litellm/connection",
        "PUT",
        { baseUrl: value, version: version === 0 ? null : version },
        StatusSchema,
      ),
    onSuccess: (next) => queryClient.setQueryData(STATUS_KEY, next),
  });
  return (
    <form
      className="flex max-w-[72ch] flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label htmlFor="litellm-base-url" className="text-sm font-medium">
        Base URL
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          id="litellm-base-url"
          type="url"
          className="min-w-64 flex-1"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        />
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </div>
      {stored === null || value.trim() !== stored ? (
        <p className="text-muted-foreground text-sm">
          Not saved yet. Save tests this URL and stores it.
        </p>
      ) : null}
      {save.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {save.error.message}
        </p>
      ) : null}
    </form>
  );
}

export function LiteLLMConnectionSection({ canEdit }: { canEdit: boolean }) {
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => fetchApi("/api/litellm/connection", StatusSchema),
  });
  // The field value lives here so the test button reads it; a draft belongs to
  // one saved state and resets when the saved URL or version changes.
  const [draft, setDraft] = useState<{ key: string; value: string } | null>(
    null,
  );
  const test = useMutation({
    mutationFn: ({ baseUrl }: { baseUrl: string; unsaved: boolean }) =>
      mutateApi(
        "/api/litellm/connection/test",
        "POST",
        baseUrl === "" ? {} : { baseUrl },
        ConnectionTestResultSchema,
      ),
  });

  if (status.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {status.error.message}
      </p>
    );
  }
  if (status.data === undefined) return <PanelSkeleton />;

  const s = status.data;
  const formKey = `${s.version}:${s.baseUrl ?? ""}`;
  const fieldValue =
    draft?.key === formKey
      ? draft.value
      : (s.baseUrl ?? s.defaultBaseUrl ?? "");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm">
        <div>
          <span className="text-muted-foreground">Base URL: </span>
          {s.baseUrl === null ? (
            <span>Not configured</span>
          ) : (
            <span className="font-mono">{s.baseUrl}</span>
          )}
        </div>
        <div>
          Edition: <span className="font-mono">{s.edition}</span>
        </div>
        <div>
          Service key configured:{" "}
          <span className="font-mono">
            {s.serviceKeyConfigured ? "yes" : "no"}
          </span>
        </div>
      </div>
      {canEdit ? (
        <>
          <BaseUrlForm
            key={formKey}
            stored={s.baseUrl}
            value={fieldValue}
            onValueChange={(next) => setDraft({ key: formKey, value: next })}
            version={s.version}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={test.isPending}
              onClick={() => {
                const baseUrl = fieldValue.trim();
                test.mutate({
                  baseUrl,
                  unsaved: baseUrl !== "" && baseUrl !== s.baseUrl,
                });
              }}
            >
              Test connection
            </Button>
            <div aria-live="polite">
              {test.data ? (
                <p
                  className={
                    test.data.result === "ok"
                      ? "text-success-text flex items-center gap-1.5 text-sm"
                      : "text-destructive flex items-center gap-1.5 text-sm"
                  }
                >
                  {test.data.result === "ok" ? (
                    <Check aria-hidden className="text-success size-4" />
                  ) : (
                    <X aria-hidden className="size-4" />
                  )}
                  {test.data.result === "ok" ? (
                    <>
                      <span>LiteLLM connection is ok</span>
                      {test.variables?.unsaved ? (
                        <span className="text-muted-foreground">
                          not saved yet
                        </span>
                      ) : null}
                      <span className="text-muted-foreground">
                        {test.data.message}
                      </span>
                    </>
                  ) : (
                    <span>{test.data.message}</span>
                  )}
                </p>
              ) : null}
              {test.isError ? (
                <p
                  role="alert"
                  className="text-destructive flex items-center gap-1.5 text-sm"
                >
                  <X aria-hidden className="size-4" />
                  <span>{test.error.message}</span>
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
      {test.data?.warnings?.length ? (
        <div
          data-testid="litellm-wildcard-warning"
          role="status"
          className="border-warning bg-warning/10 rounded-md border p-2 text-sm"
        >
          {test.data.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
