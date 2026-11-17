"use client";

import {
  BedrockGatewayViewSchema,
  type BedrockGatewayView,
} from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import { NativeSelect } from "@/components/litellm/team/native-select";
import { PanelSkeleton } from "@/components/settings/litellm-panel/PanelSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiRequestError, fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: docs/specs/2026-11-10-litellm.md -- "Combined usage and My usage
// (L6)": Gateway configuration and Where each figure appears (Settings ->
// LiteLLM -> Gateway). Admin edits; Auditor and org-admin read only (LD24).

const GATEWAY_KEY = ["litellm", "gateway"] as const;
const PRINCIPAL_LABEL = { "iam-role": "IAM role", "usage-key": "Usage key" };
type PrincipalType = keyof typeof PRINCIPAL_LABEL;

type PrincipalRow = { id: number; type: PrincipalType; value: string };
type AccountRow = { id: number; value: string };
type Payload = {
  principals: { type: PrincipalType; value: string }[];
  accountIds: string[];
};

function errorText(error: unknown): string {
  if (error instanceof ApiRequestError && error.status === 409) {
    return "Changed elsewhere — reload";
  }
  return error instanceof Error ? error.message : "Could not save.";
}

function ReadOnly({ view }: { view: BedrockGatewayView }) {
  return (
    <div className="flex max-w-[72ch] flex-col gap-4">
      {view.principals.length === 0 && view.accountIds.length === 0 ? (
        <p role="status" className="text-muted-foreground text-sm">
          No gateway configured.
        </p>
      ) : (
        <>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Principals</legend>
            <ul className="flex flex-col gap-1 text-sm">
              {view.principals.map((p) => (
                <li key={`${p.type}:${p.value}`} className="flex gap-3">
                  <span className="text-muted-foreground w-20 shrink-0">
                    {PRINCIPAL_LABEL[p.type]}
                  </span>
                  <span className="font-mono break-all">{p.value}</span>
                </li>
              ))}
            </ul>
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Account IDs</legend>
            <ul className="flex flex-col gap-1 text-sm">
              {view.accountIds.map((id) => (
                <li key={id}>
                  <span className="font-mono">{id}</span>
                </li>
              ))}
            </ul>
          </fieldset>
        </>
      )}
    </div>
  );
}

function Editor({
  view,
  pending,
  error,
  saved,
  onSave,
  onEdit,
}: {
  view: BedrockGatewayView;
  pending: boolean;
  error: unknown;
  saved: boolean;
  onSave: (payload: Payload) => void;
  onEdit: () => void;
}) {
  const [principals, setPrincipals] = useState<PrincipalRow[]>(() =>
    view.principals.map((p, id) => ({ id, ...p })),
  );
  const [accounts, setAccounts] = useState<AccountRow[]>(() =>
    view.accountIds.map((value, i) => ({
      id: view.principals.length + i,
      value,
    })),
  );
  // Row keys are stable ids, never indices (Rule 60.14).
  const [nextId, setNextId] = useState(
    view.principals.length + view.accountIds.length,
  );
  const fresh = () => {
    setNextId(nextId + 1);
    return nextId;
  };
  const wasEmpty = view.principals.length === 0 && view.accountIds.length === 0;

  const editPrincipals = (next: PrincipalRow[]) => {
    onEdit();
    setPrincipals(next);
  };
  const editAccounts = (next: AccountRow[]) => {
    onEdit();
    setAccounts(next);
  };
  const patchPrincipal = (id: number, patch: Partial<PrincipalRow>) =>
    editPrincipals(
      principals.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );

  return (
    <form
      className="flex max-w-[72ch] flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          principals: principals.map(({ type, value }) => ({ type, value })),
          accountIds: accounts.map((a) => a.value),
        });
      }}
    >
      {wasEmpty ? (
        <p role="status" className="text-muted-foreground text-sm">
          No gateway configured.
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Principals</legend>
        {principals.map((row, index) => (
          <div key={row.id} className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label={`Principal ${index + 1} type`}
              className="w-36"
              value={row.type}
              onChange={(e) =>
                patchPrincipal(row.id, {
                  type:
                    e.target.value === "usage-key" ? "usage-key" : "iam-role",
                })
              }
            >
              <option value="iam-role">{PRINCIPAL_LABEL["iam-role"]}</option>
              <option value="usage-key">{PRINCIPAL_LABEL["usage-key"]}</option>
            </NativeSelect>
            <Input
              aria-label={`Principal ${index + 1} value`}
              className="min-w-64 flex-1 font-mono"
              value={row.value}
              onChange={(e) =>
                patchPrincipal(row.id, { value: e.target.value })
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove principal ${index + 1}`}
              onClick={() =>
                editPrincipals(principals.filter((p) => p.id !== row.id))
              }
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() =>
            editPrincipals([
              ...principals,
              { id: fresh(), type: "iam-role", value: "" },
            ])
          }
        >
          <Plus aria-hidden="true" />
          Add principal
        </Button>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Account IDs</legend>
        {accounts.map((row, index) => (
          <div key={row.id} className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={`Account ID ${index + 1}`}
              className="w-48 font-mono"
              inputMode="numeric"
              value={row.value}
              onChange={(e) =>
                editAccounts(
                  accounts.map((a) =>
                    a.id === row.id ? { ...a, value: e.target.value } : a,
                  ),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove account ${index + 1}`}
              onClick={() =>
                editAccounts(accounts.filter((a) => a.id !== row.id))
              }
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() =>
            editAccounts([...accounts, { id: fresh(), value: "" }])
          }
        >
          <Plus aria-hidden="true" />
          Add account
        </Button>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        {saved ? (
          <p role="status" className="text-sm">
            Saved
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {errorText(error)}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function LiteLLMGatewaySection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const query = useQuery({
    queryKey: GATEWAY_KEY,
    queryFn: () => fetchApi("/api/litellm/gateway", BedrockGatewayViewSchema),
  });
  const save = useMutation({
    mutationFn: (vars: { version: number; payload: Payload }) =>
      mutateApi(
        "/api/litellm/gateway",
        "PUT",
        {
          version: vars.version === 0 ? null : vars.version,
          ...vars.payload,
        },
        BedrockGatewayViewSchema,
      ),
    onSuccess: (next) => {
      setSaved(true);
      queryClient.setQueryData(GATEWAY_KEY, next);
    },
  });

  if (query.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {query.error.message}
      </p>
    );
  }
  if (query.data === undefined) return <PanelSkeleton />;
  const view = query.data;
  if (!canEdit) return <ReadOnly view={view} />;
  return (
    <Editor
      key={view.version}
      view={view}
      pending={save.isPending}
      error={save.error}
      saved={saved}
      onEdit={() => setSaved(false)}
      onSave={(payload) => {
        setSaved(false);
        save.mutate({ version: view.version, payload });
      }}
    />
  );
}
