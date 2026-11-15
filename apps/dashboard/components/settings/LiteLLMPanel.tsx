"use client";

import {
  ConnectionTestResultSchema,
  LiteLLMConnectionStatusSchema,
  OperationTogglesViewSchema,
} from "@llm-usage-lens/shared";
import type { OperationTogglesView } from "@llm-usage-lens/shared";
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
const TOGGLES_KEY = ["litellm", "toggles"] as const;

type Toggles = OperationTogglesView;

const WRITE_OPS = new Set([
  "createTeam",
  "setTeamBudget",
  "setTeamLimits",
  "setTeamModels",
  "addTeamMember",
  "removeTeamMember",
  "setMemberBudget",
  "setMemberLimits",
  "resetMemberSpend",
  "resetMemberBudget",
  "disableMember",
  "enableMember",
  "generateMemberKey",
  "updateMemberKey",
  "blockKey",
  "unblockKey",
  "deleteKey",
  "rotateKey",
]);

const CODE_GUARDRAILS = [
  "Operation allowlist: only the listed operations can be called",
  "Fixed route templates, never built from free text",
  "Hard-limit budgets only; soft budgets are not used",
  "Path-parameter values are validated before use",
  "Exact request bodies per operation; unknown fields are rejected",
  "Edition gate: operations that need a paid edition are refused",
  "litellm-changed-by header is sent on every write",
  "Inference traffic is never proxied through the dashboard",
];

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

function OperationRow({
  op,
  enabled,
  source,
  canEdit,
  pending,
  onToggle,
}: {
  op: string;
  enabled: boolean;
  source: string;
  canEdit: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      data-testid={`litellm-op-${op}`}
      className="flex items-center justify-between gap-3 py-1 text-sm"
    >
      <span className="font-mono">{op}</span>
      <span className="flex items-center gap-3">
        <span
          data-testid={`litellm-op-source-${op}`}
          className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs"
        >
          {source}
        </span>
        {canEdit ? (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={op}
            disabled={pending}
            onClick={onToggle}
            className={`focus-visible:ring-ring relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50 ${
              enabled ? "bg-primary" : "bg-input"
            }`}
          >
            <span
              aria-hidden="true"
              className={`bg-background block size-4 rounded-full transition-transform ${
                enabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        ) : (
          <span className="w-8 text-right">{enabled ? "On" : "Off"}</span>
        )}
      </span>
    </li>
  );
}

function OperationGroup({
  label,
  ops,
  data,
  canEdit,
  pending,
  onToggle,
}: {
  label: string;
  ops: string[];
  data: Toggles;
  canEdit: boolean;
  pending: boolean;
  onToggle: (op: string, enabled: boolean) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      <h4 className="text-sm font-medium">{label}</h4>
      <ul className="divide-border divide-y">
        {Object.entries(data.operations)
          .filter(([op]) => ops.includes(op))
          .map(([op, v]) => (
            <OperationRow
              key={op}
              op={op}
              enabled={v.enabled}
              source={v.source}
              canEdit={canEdit}
              pending={pending}
              onToggle={() => onToggle(op, !v.enabled)}
            />
          ))}
      </ul>
    </div>
  );
}

function TogglesSection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const query = useQuery({
    queryKey: TOGGLES_KEY,
    queryFn: () => fetchApi("/api/litellm/toggles", OperationTogglesViewSchema),
  });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      mutateApi(
        "/api/litellm/toggles",
        "PUT",
        body,
        OperationTogglesViewSchema,
      ),
    onSuccess: (next) => {
      queryClient.setQueryData(TOGGLES_KEY, next);
      setConfirming(false);
    },
  });

  if (query.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {query.error.message}
      </p>
    );
  }
  if (query.data === undefined) {
    return (
      <div
        data-testid="litellm-toggles-loading"
        className="flex flex-col gap-2"
      >
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const data = query.data;
  const names = Object.keys(data.operations);
  const toggle = (op: string, enabled: boolean) =>
    save.mutate({ version: data.version, toggles: { [op]: enabled } });
  const shared = { data, canEdit, pending: save.isPending, onToggle: toggle };
  return (
    <div className="flex max-w-[72ch] flex-col gap-4">
      <OperationGroup
        label="Write operations"
        ops={names.filter((n) => WRITE_OPS.has(n))}
        {...shared}
      />
      <OperationGroup
        label="Read operations"
        ops={names.filter((n) => !WRITE_OPS.has(n))}
        {...shared}
      />
      {canEdit ? (
        confirming ? (
          <div
            role="group"
            aria-label="Confirm reset"
            className="flex flex-wrap items-center gap-3"
          >
            <span className="text-sm">
              Delete the saved values and use the file defaults?
            </span>
            <Button
              type="button"
              variant="destructive"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({ version: data.version, reset: true })
              }
            >
              Confirm reset
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(true)}
            >
              Reset to file defaults
            </Button>
          </div>
        )
      ) : null}
      {save.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {save.error.message}
        </p>
      ) : null}
    </div>
  );
}

function EnforcedInCode() {
  return (
    <section
      aria-labelledby="litellm-enforced-heading"
      className="max-w-[72ch]"
    >
      <h4 id="litellm-enforced-heading" className="text-sm font-medium">
        Enforced in code
      </h4>
      <ul className="text-muted-foreground list-disc pl-5 text-sm">
        {CODE_GUARDRAILS.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ul>
    </section>
  );
}

export function LiteLLMPanel({ canEdit = true }: { canEdit?: boolean }) {
  const togglesInfo = useQuery({
    queryKey: TOGGLES_KEY,
    queryFn: () => fetchApi("/api/litellm/toggles", OperationTogglesViewSchema),
  });
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
      {togglesInfo.data?.wildcardWarning && test.data?.warnings?.length ? (
        <div
          data-testid="litellm-wildcard-warning"
          className="border-border rounded-md border p-2 text-sm"
        >
          {test.data.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}
      <TogglesSection canEdit={canEdit} />
      <EnforcedInCode />
    </div>
  );
}
