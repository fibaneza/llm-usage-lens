"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import { accessErrorMessage } from "@/components/settings/access/access-error-message";
import {
  directoryOf,
  personName,
  useIdentityDirectory,
} from "@/components/settings/access/access-queries";
import {
  IgnoredSchema,
  PerUserApprovalStateSchema,
} from "@/components/settings/access/access-schemas";
import {
  FormError,
  FormField,
} from "@/components/settings/access/form-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchApi, mutateApi } from "@/lib/query/fetch-api";
import { sectionData } from "@/lib/query/section-data";

// Source: docs/specs/2026-11-10-access-control.md - "Visibility and
// inheritance" (organisation cap: until an internal-admin records the works-
// council or data-protection approval - who, when, reference - every caller
// sees per-user counts only), "API routes (additions)" (GET admin or auditor,
// PUT internal-admin). The spec defines no withdrawal, so there is no revoke.
const MAX_REFERENCE = 200;
const KEY = ["access", "per-user-approval"] as const;

function utcStamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function PerUserApprovalSection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const state = sectionData(
    useQuery({
      queryKey: KEY,
      queryFn: () =>
        fetchApi(
          "/api/governance/per-user-approval",
          PerUserApprovalStateSchema,
        ),
    }),
  );
  const directory = useIdentityDirectory();
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const save = useMutation({
    mutationFn: (input: { reference: string; version: number }) =>
      mutateApi(
        "/api/governance/per-user-approval",
        "PUT",
        input,
        IgnoredSchema,
      ),
    onSuccess: () => {
      setReference(null);
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });

  if (state === undefined || directory.isPending) {
    return <Skeleton className="h-32 w-full" />;
  }
  const names = directoryOf(directory.data);
  const value = reference ?? (state.approved ? state.reference : "");
  const version = state.approved ? state.version : 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.reset();
    const trimmed = value.trim();
    if (trimmed === "") return setError("Reference is required");
    if (trimmed.length > MAX_REFERENCE) {
      return setError(`Reference must be ${MAX_REFERENCE} characters or fewer`);
    }
    setError(undefined);
    save.mutate({ reference: trimmed, version });
  }

  return (
    <div className="flex max-w-[72ch] flex-col gap-4">
      {state.approved ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Approved by</dt>
          <dd>{personName(names, state.approvedBy)}</dd>
          <dt className="text-muted-foreground">Approved on</dt>
          <dd>{utcStamp(state.approvedAt)}</dd>
          <dt className="text-muted-foreground">Reference</dt>
          <dd>{state.reference}</dd>
        </dl>
      ) : (
        <div className="flex flex-col gap-2">
          <div>
            <Badge variant="outline">Not approved</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Until the works-council or data-protection approval is recorded,
            per-user cost shows counts only.
          </p>
        </div>
      )}

      {canEdit ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <FormField label="Reference" error={error}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                value={value}
                onChange={(e) => setReference(e.target.value)}
              />
            )}
          </FormField>
          <div>
            <Button type="submit" size="sm" disabled={save.isPending}>
              {state.approved ? "Update approval" : "Record approval"}
            </Button>
          </div>
          {save.isError ? (
            <FormError>{accessErrorMessage(save.error)}</FormError>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
