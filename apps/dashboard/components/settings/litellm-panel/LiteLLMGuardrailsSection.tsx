"use client";

import { OperationTogglesViewSchema } from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { OperationGroup } from "@/components/settings/litellm-panel/OperationGroup";
import {
  OPERATION_FAMILIES,
  OPERATION_INFO,
  OTHER_FAMILY,
} from "@/components/settings/litellm-panel/operation-families";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchApi, mutateApi } from "@/lib/query/fetch-api";

const TOGGLES_KEY = ["litellm", "toggles"] as const;

const CODE_GUARDRAILS = [
  "Operation allowlist and its method + route templates: only the listed operations can be called",
  "Hard-limit denylist: routes that can mint, reveal or widen access are never callable",
  "Path-parameter patterns and encoding: values are validated and encoded before use",
  "Exact request bodies per operation; unknown fields are rejected",
  "Edition gate: operations that need a paid edition are refused",
  "litellm-changed-by header is sent on every write",
  "Inference refusal: inference traffic is never proxied through the dashboard (pending verification)",
];

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
  const toggle = (op: string, enabled: boolean) =>
    save.mutate({
      version: data.version === 0 ? null : data.version,
      toggles: { [op]: enabled },
    });
  const groups = [...OPERATION_FAMILIES, OTHER_FAMILY].map((family) => ({
    ...family,
    ops: Object.entries(data.operations)
      .filter(
        ([op]) => (OPERATION_INFO[op]?.family ?? OTHER_FAMILY.id) === family.id,
      )
      .map(([name, v]) => ({
        name,
        enabled: v.enabled,
        source: v.source,
        unavailable: v.unavailable,
      })),
  }));
  return (
    <div className="flex max-w-[72ch] flex-col gap-4">
      {groups
        .filter((g) => g.ops.length > 0)
        .map((g) => (
          <OperationGroup
            key={g.id}
            id={g.id}
            label={g.label}
            description={g.description}
            ops={g.ops}
            canEdit={canEdit}
            pending={save.isPending}
            onToggle={toggle}
          />
        ))}
      {canEdit ? (
        confirming ? (
          <div
            role="group"
            aria-label="Confirm reset"
            className="flex flex-wrap items-center gap-3"
          >
            <span className="text-sm">
              Delete the saved values and use the defaults? Operations set in
              config.yaml keep their file value.
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
              disabled={data.version === 0}
              onClick={() => setConfirming(true)}
            >
              Reset to defaults
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

export function LiteLLMGuardrailsSection({ canEdit }: { canEdit: boolean }) {
  return (
    <>
      <TogglesSection canEdit={canEdit} />
      <EnforcedInCode />
    </>
  );
}
