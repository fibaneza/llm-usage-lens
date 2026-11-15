"use client";

import { GrantableRoleSchema, RoleGrantSchema } from "@llm-usage-lens/shared";
import type { GrantableRole, RoleGrant } from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import { accessErrorMessage } from "@/components/settings/access/access-error-message";
import {
  directoryOf,
  fetchAllPages,
  idPath,
  personLabel,
  personName,
  useIdentityDirectory,
} from "@/components/settings/access/access-queries";
import type { Directory } from "@/components/settings/access/access-queries";
import { IgnoredSchema } from "@/components/settings/access/access-schemas";
import { ConfirmDialog } from "@/components/settings/access/ConfirmDialog";
import {
  FormError,
  FormField,
  NativeSelect,
  NativeTextarea,
  restoreFocusTo,
} from "@/components/settings/access/form-controls";
import { StepUpDialog } from "@/components/settings/access/StepUpDialog";
import type {
  AccessViewer,
  StepUpActions,
} from "@/components/settings/access/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { ApiRequestError, mutateApi } from "@/lib/query/fetch-api";
import { sectionData } from "@/lib/query/section-data";

// Source: docs/specs/2026-11-10-access-control.md - "Roles" (internal-admin
// only; the last internal-admin grant cannot be revoked: 409), "Recent
// authentication" (D28: a write answers 403 REAUTH_REQUIRED without a sign-in
// in the last 15 minutes; the UI asks 'Confirm it's you', never replays the
// write, and a second REAUTH_REQUIRED straight after a step-up is an error, not
// another step-up), "API routes (additions)", threat T32.
const GRANTABLE_ROLES = GrantableRoleSchema.options;
const MAX_REASON = 500;
const NOT_RECENT =
  "Your sign-in could not be confirmed as recent. Sign out and sign in again, then retry.";

type Draft = { oid: string; role: GrantableRole; reason: string };
type DraftErrors = Partial<Record<"oid" | "reason", string>>;

const EMPTY_DRAFT: Draft = { oid: "", role: "internal-org-admin", reason: "" };

function isReauth(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "REAUTH_REQUIRED";
}

function GrantDialog({
  directory,
  people,
  draft,
  onDraft,
  pending,
  serverError,
  onGrant,
  onClose,
  returnFocusTo,
}: {
  returnFocusTo: RefObject<HTMLElement | null>;
  directory: Directory;
  people: string[];
  draft: Draft;
  onDraft: (next: Draft) => void;
  pending: boolean;
  serverError: string | null;
  onGrant: () => void;
  onClose: () => void;
}) {
  const [errors, setErrors] = useState<DraftErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: DraftErrors = {};
    if (draft.oid === "") found.oid = "Choose a person";
    const reason = draft.reason.trim();
    if (reason === "") found.reason = "Reason is required";
    else if (reason.length > MAX_REASON) {
      found.reason = `Reason must be ${MAX_REASON} characters or fewer`;
    }
    setErrors(found);
    if (Object.keys(found).length === 0) onGrant();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onCloseAutoFocus={restoreFocusTo(returnFocusTo)}>
        <DialogHeader>
          <DialogTitle>Grant role</DialogTitle>
          <DialogDescription>
            The reason is recorded in the audit log with this grant.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormField label="Person" error={errors.oid}>
            {(props) => (
              <NativeSelect
                {...props}
                value={draft.oid}
                onChange={(e) => onDraft({ ...draft, oid: e.target.value })}
              >
                <option value="">Select a person</option>
                {people.map((oid) => {
                  const identity = directory.get(oid);
                  return (
                    <option key={oid} value={oid}>
                      {identity ? personLabel(identity) : oid}
                    </option>
                  );
                })}
              </NativeSelect>
            )}
          </FormField>
          <FormField label="Role">
            {(props) => (
              <NativeSelect
                {...props}
                value={draft.role}
                onChange={(e) =>
                  onDraft({
                    ...draft,
                    role: GrantableRoleSchema.parse(e.target.value),
                  })
                }
              >
                {GRANTABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField label="Reason" error={errors.reason}>
            {(props) => (
              <NativeTextarea
                {...props}
                value={draft.reason}
                onChange={(e) => onDraft({ ...draft, reason: e.target.value })}
              />
            )}
          </FormField>
          {serverError ? <FormError>{serverError}</FormError> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Grant
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RoleGrantsSection({
  canEdit,
  authMethod,
  stepUp,
}: {
  canEdit: boolean;
  authMethod: AccessViewer["authMethod"];
  stepUp: StepUpActions;
}) {
  const queryClient = useQueryClient();
  const grants = sectionData(
    useQuery({
      queryKey: ["access", "role-grants"],
      queryFn: () => fetchAllPages("/api/role-grants", RoleGrantSchema),
    }),
  );
  const directory = useIdentityDirectory();

  const grantButton = useRef<HTMLButtonElement>(null);
  const [granting, setGranting] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [revoking, setRevoking] = useState<RoleGrant | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  // True once a step-up has completed in this view: a REAUTH_REQUIRED after it
  // is an error, not another prompt.
  const [steppedUp, setSteppedUp] = useState(false);
  const [notRecent, setNotRecent] = useState(false);

  function onWriteError(error: unknown) {
    if (!isReauth(error)) return;
    if (steppedUp) setNotRecent(true);
    else setStepUpOpen(true);
  }
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["access", "role-grants"] });

  const grant = useMutation({
    mutationFn: (input: Draft) =>
      mutateApi(
        "/api/role-grants",
        "POST",
        { oid: input.oid, role: input.role, reason: input.reason.trim() },
        IgnoredSchema,
      ),
    onSuccess: () => {
      setGranting(false);
      setDraft(EMPTY_DRAFT);
      setSteppedUp(false);
      void refresh();
    },
    onError: onWriteError,
  });
  const revoke = useMutation({
    mutationFn: (target: RoleGrant) =>
      mutateApi(
        `/api/role-grants/${idPath(target.oid)}/${idPath(target.role)}`,
        "DELETE",
        { version: target.version },
        IgnoredSchema,
      ),
    onSuccess: () => {
      setRevoking(null);
      setSteppedUp(false);
      void refresh();
    },
    onError: (error) => {
      onWriteError(error);
      void refresh();
    },
  });

  if (grants === undefined || directory.isPending) {
    return <Skeleton className="h-40 w-full" />;
  }
  const names = directoryOf(directory.data);

  function messageFor(mutation: { isError: boolean; error: unknown }) {
    if (notRecent) return NOT_RECENT;
    if (!mutation.isError || isReauth(mutation.error)) return null;
    return accessErrorMessage(mutation.error);
  }

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div>
          <Button
            ref={grantButton}
            type="button"
            size="sm"
            onClick={() => {
              grant.reset();
              setNotRecent(false);
              setGranting(true);
            }}
          >
            <Plus aria-hidden />
            Grant role
          </Button>
        </div>
      ) : null}

      {grants.length === 0 ? (
        <EmptyState title="No role grants yet." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Granted by</TableHead>
              <TableHead>Granted</TableHead>
              {canEdit ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.map((item) => {
              const name = personName(names, item.oid);
              const email = names.get(item.oid)?.email;
              return (
                <TableRow key={`${item.oid}:${item.role}`}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{name}</span>
                      {email && email !== name ? (
                        <span className="text-muted-foreground text-xs">
                          {email}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{ROLE_LABELS[item.role]}</TableCell>
                  <TableCell className="max-w-[40ch] whitespace-normal">
                    {item.reason}
                  </TableCell>
                  <TableCell>{personName(names, item.grantedBy)}</TableCell>
                  <TableCell>{item.grantedAt.slice(0, 10)}</TableCell>
                  {canEdit ? (
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Revoke ${ROLE_LABELS[item.role]} from ${name}`}
                        onClick={() => {
                          revoke.reset();
                          setNotRecent(false);
                          setRevoking(item);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {granting ? (
        <GrantDialog
          returnFocusTo={grantButton}
          directory={names}
          people={(directory.data ?? []).map((i) => i.oid)}
          draft={draft}
          onDraft={setDraft}
          pending={grant.isPending}
          serverError={messageFor(grant)}
          onGrant={() => {
            setNotRecent(false);
            grant.mutate(draft);
          }}
          onClose={() => setGranting(false)}
        />
      ) : null}
      {revoking ? (
        <ConfirmDialog
          title="Revoke role"
          description={`Revoke ${ROLE_LABELS[revoking.role]} from ${personName(names, revoking.oid)}?`}
          confirmLabel="Revoke"
          pending={revoke.isPending}
          error={messageFor(revoke)}
          onConfirm={() => {
            setNotRecent(false);
            revoke.mutate(revoking);
          }}
          onClose={() => setRevoking(null)}
        />
      ) : null}
      {stepUpOpen ? (
        <StepUpDialog
          authMethod={authMethod}
          stepUp={stepUp}
          section="role-grants"
          onDone={() => {
            setStepUpOpen(false);
            setSteppedUp(true);
          }}
          onClose={() => setStepUpOpen(false)}
        />
      ) : null}
    </div>
  );
}
