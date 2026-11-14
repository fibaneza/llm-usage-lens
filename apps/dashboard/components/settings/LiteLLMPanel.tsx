"use client";

import {
  ConnectionTestResultSchema,
  LiteLLMConnectionStatusSchema,
} from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: docs/specs/2026-11-10-litellm.md — "Page and Settings" and "Security
// architecture" item 6: the Admin panel shows the connection URL, the edition
// (read-only) and whether the service key is configured, plus a connection
// test. There is no input for the key and its value is never fetched or shown.

// Unknown fields in a response are dropped, never rendered.
const StatusSchema = LiteLLMConnectionStatusSchema.strip();
const STATUS_KEY = ["litellm", "connection"] as const;

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}

function BaseUrlForm({
  stored,
  version,
}: {
  stored: string | null;
  version: number;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(stored ?? "");
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
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </div>
      {save.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {save.error.message}
        </p>
      ) : null}
    </form>
  );
}

export function LiteLLMPanel() {
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => fetchApi("/api/litellm/connection", StatusSchema),
  });
  const test = useMutation({
    mutationFn: () =>
      mutateApi(
        "/api/litellm/connection/test",
        "POST",
        {},
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
      <BaseUrlForm
        key={`${s.version}:${s.baseUrl ?? ""}`}
        stored={s.baseUrl}
        version={s.version}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={test.isPending}
          onClick={() => test.mutate()}
        >
          Test connection
        </Button>
        {test.data ? (
          <p
            role="status"
            className={
              test.data.result === "ok" ? "text-sm" : "text-destructive text-sm"
            }
          >
            {test.data.message}
          </p>
        ) : null}
        {test.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {test.error.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
