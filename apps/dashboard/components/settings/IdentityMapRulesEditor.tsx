"use client";

import {
  IdentityMapRuleSchema,
  IdentityMapRulesInputSchema,
  MAX_IDENTITY_MAP_RULES,
} from "@llm-usage-lens/shared";
import type { IdentityMapRule } from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi, mutateApi } from "@/lib/query/fetch-api";
import { requestErrorMessage } from "@/lib/query/request-error-message";

// Source: docs/specs/2026-11-10-access-control.md - "Usage-identity mapping
// rules (D27)": an internal-admin defines the ordered rules; the first match
// decides; rules only suggest a link and never grant access. The routes are
// derived from D27 (the API list names none).
const RULES_PATH = "/api/governance/identity-map-rules";
const RULES_KEY = ["identity-map-rules"] as const;

const StoredRulesSchema = z.object({
  rules: z.array(IdentityMapRuleSchema),
  version: z.number().int().min(0),
});

type DialogState =
  | { kind: "add" }
  | { kind: "edit"; index: number }
  | { kind: "delete"; index: number }
  | null;

type FieldErrors = { pattern?: string; template?: string };

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}

function validateCandidate(
  candidate: IdentityMapRule[],
  index: number,
): FieldErrors {
  const parsed = IdentityMapRulesInputSchema.safeParse({ rules: candidate });
  if (parsed.success) return {};
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const [, at, field] = issue.path;
    if (at !== undefined && at !== index) continue;
    const key = field === "template" ? "template" : "pattern";
    errors[key] ??= issue.message;
  }
  return errors;
}

function RuleDialog({
  rules,
  index,
  pending,
  serverError,
  onSave,
  onClose,
}: {
  rules: IdentityMapRule[];
  index: number | null;
  pending: boolean;
  serverError: string | null;
  onSave: (next: IdentityMapRule[]) => void;
  onClose: () => void;
}) {
  const formId = useId();
  const existing = index === null ? undefined : rules[index];
  const [pattern, setPattern] = useState(existing?.pattern ?? "");
  const [template, setTemplate] = useState(existing?.template ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const rule = { pattern, template };
    const at = index ?? rules.length;
    const candidate = rules.slice();
    candidate[at] = rule;
    const found = validateCandidate(candidate, at);
    setErrors(found);
    if (Object.keys(found).length === 0) onSave(candidate);
  }

  const fields = [
    {
      key: "pattern",
      label: "Pattern",
      value: pattern,
      set: setPattern,
      hint: "One {name} placeholder, matched against the session name.",
    },
    {
      key: "template",
      label: "Email template",
      value: template,
      set: setTemplate,
      hint: "An email address with one {name} placeholder.",
    },
  ] as const;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit rule" : "Add rule"}</DialogTitle>
          <DialogDescription>
            The session name is the part of a usage key after its last / or :.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={submit}
          noValidate
          className="flex max-w-[72ch] flex-col gap-4"
        >
          {fields.map(({ key, label, value, set, hint }) => {
            const id = `${formId}-${key}`;
            const error = errors[key];
            return (
              <div key={key} className="flex flex-col gap-1.5">
                <label htmlFor={id} className="text-sm font-medium">
                  {label}
                </label>
                <Input
                  id={id}
                  value={value}
                  aria-invalid={error !== undefined}
                  aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
                  onChange={(e) => set(e.target.value)}
                />
                <p id={`${id}-hint`} className="text-muted-foreground text-xs">
                  {hint}
                </p>
                {error ? (
                  <p
                    id={`${id}-error`}
                    role="alert"
                    className="text-destructive text-sm"
                  >
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
          {serverError ? <ErrorLine message={serverError} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save rule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  rule,
  pending,
  serverError,
  onConfirm,
  onClose,
}: {
  rule: IdentityMapRule;
  pending: boolean;
  serverError: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete rule</DialogTitle>
          <DialogDescription>
            Delete the rule <code>{rule.pattern}</code>? Links already confirmed
            stay in place.
          </DialogDescription>
        </DialogHeader>
        {serverError ? <ErrorLine message={serverError} /> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IdentityMapRulesEditor({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>(null);
  const query = useQuery({
    queryKey: RULES_KEY,
    queryFn: () => fetchApi(RULES_PATH, StoredRulesSchema),
  });
  const version = query.data?.version ?? 0;
  const save = useMutation({
    mutationFn: (rules: IdentityMapRule[]) =>
      mutateApi(RULES_PATH, "PUT", { rules, version }, StoredRulesSchema),
    onSettled: () => queryClient.invalidateQueries({ queryKey: RULES_KEY }),
  });

  if (query.isPending) return <PanelSkeleton />;
  if (query.isError)
    return <ErrorLine message={requestErrorMessage(query.error)} />;

  const rules = query.data.rules;
  const busy = save.isPending || query.isFetching;
  const serverError = save.isError ? requestErrorMessage(save.error) : null;

  function open(next: DialogState) {
    save.reset();
    setDialog(next);
  }
  function close() {
    setDialog(null);
  }
  function commit(next: IdentityMapRule[]) {
    save.mutate(next, { onSuccess: close });
  }
  function move(index: number, by: -1 | 1) {
    const next = rules.slice();
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(index + by, 0, moved);
    save.mutate(next);
  }

  const deleteIndex = dialog?.kind === "delete" ? dialog.index : null;
  const deleting = deleteIndex === null ? undefined : rules[deleteIndex];

  return (
    <section
      aria-labelledby="identity-map-rules-title"
      className="flex flex-col gap-4"
    >
      <div className="flex max-w-[72ch] flex-col gap-1">
        <h3 id="identity-map-rules-title" className="text-base font-semibold">
          Usage-identity mapping rules
        </h3>
        <p className="text-muted-foreground text-sm">
          A rule suggests an identity link for a usage key that is not an email.
          The first matching rule decides; a rule never grants access or links
          anyone on its own.
        </p>
      </div>

      {rules.length === 0 ? (
        <p className="text-muted-foreground text-sm">No mapping rules yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pattern</TableHead>
              <TableHead>Email template</TableHead>
              {isAdmin ? <TableHead>Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule, index) => (
              <TableRow key={rule.pattern.toLowerCase()}>
                <TableCell className="font-mono">{rule.pattern}</TableCell>
                <TableCell className="font-mono">{rule.template}</TableCell>
                {isAdmin ? (
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move rule ${rule.pattern} up`}
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move rule ${rule.pattern} down`}
                        disabled={busy || index === rules.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit rule ${rule.pattern}`}
                        disabled={busy}
                        onClick={() => open({ kind: "edit", index })}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete rule ${rule.pattern}`}
                        disabled={busy}
                        onClick={() => open({ kind: "delete", index })}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {isAdmin ? (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={busy || rules.length >= MAX_IDENTITY_MAP_RULES}
            onClick={() => open({ kind: "add" })}
          >
            <Plus aria-hidden /> Add rule
          </Button>
        </div>
      ) : null}

      {dialog === null && serverError ? (
        <ErrorLine message={serverError} />
      ) : null}

      {dialog?.kind === "add" || dialog?.kind === "edit" ? (
        <RuleDialog
          rules={rules}
          index={dialog.kind === "edit" ? dialog.index : null}
          pending={busy}
          serverError={serverError}
          onSave={commit}
          onClose={close}
        />
      ) : null}
      {deleting ? (
        <DeleteDialog
          rule={deleting}
          pending={busy}
          serverError={serverError}
          onConfirm={() => commit(rules.filter((_, i) => i !== deleteIndex))}
          onClose={close}
        />
      ) : null}
    </section>
  );
}
