"use client";

import { PasswordUserListItemSchema } from "@llm-usage-lens/shared";
import type { PasswordUserListItem } from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  KeyRound,
  Plus,
  ShieldOff,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { z } from "zod";

import { EmptyState } from "@/components/display/EmptyState";
import {
  accessErrorMessage,
  isReauthRequired,
} from "@/components/settings/access/access-error-message";
import {
  fetchAllPages,
  idPath,
} from "@/components/settings/access/access-queries";
import {
  IgnoredSchema,
  PasswordSignInSchema,
  PasswordUserWithLinkSchema,
} from "@/components/settings/access/access-schemas";
import { StepUpDialog } from "@/components/settings/access/StepUpDialog";
import type {
  AccessViewer,
  StepUpActions,
} from "@/components/settings/access/types";
import { ConfirmDialog } from "@/components/settings/access/ConfirmDialog";
import {
  FormError,
  FormField,
  FormStatus,
  restoreFocusTo,
} from "@/components/settings/access/form-controls";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { fetchApi, mutateApi } from "@/lib/query/fetch-api";
import { sectionData } from "@/lib/query/section-data";

// Source: docs/specs/2026-11-10-access-control.md - "Password users" (only an
// internal-admin creates, disables, re-enables, resets or deletes; Setup D22:
// creating or resetting returns a one-time setup link in exactly one response,
// never stored or shown again - the token lives in the URL fragment), "SSO
// reference and binding" (a bound user signs in with Entra only), "Alongside
// Entra" D24 (the PASSWORD_SIGNIN switch), threat T24 (token handling), "API
// routes (additions)". The routes enforce every rule again (Rule 10.3).
const SETUP_EXPIRY = "72 hours";
const STATUS_LABELS: Record<PasswordUserListItem["status"], string> = {
  enabled: "Enabled",
  "pending-setup": "Pending setup",
  disabled: "Disabled",
  "sso-bound": "SSO bound",
};

const NOT_RECENT =
  "Your sign-in could not be confirmed as recent. Sign out and sign in again, then retry.";

const EmailSchema = z.email("Enter a valid email address");

type Dialogs =
  | { kind: "reset-password"; user: PasswordUserListItem }
  | { kind: "reset-totp"; user: PasswordUserListItem }
  | { kind: "delete"; user: PasswordUserListItem }
  | null;

type CreateErrors = Partial<Record<"email" | "displayName", string>>;

function CreateDialog({
  pending,
  serverError,
  onCreate,
  onClose,
  returnFocusTo,
}: {
  returnFocusTo: RefObject<HTMLElement | null>;
  pending: boolean;
  serverError: string | null;
  onCreate: (input: {
    email: string;
    displayName: string;
    sso?: { expectedUpn?: string; expectedOid?: string };
  }) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [upn, setUpn] = useState("");
  const [oid, setOid] = useState("");
  const [errors, setErrors] = useState<CreateErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: CreateErrors = {};
    const parsedEmail = EmailSchema.safeParse(email.trim());
    if (!parsedEmail.success) found.email = "Enter a valid email address";
    if (displayName.trim() === "")
      found.displayName = "Display name is required";
    setErrors(found);
    if (Object.keys(found).length > 0 || !parsedEmail.success) return;
    const expectedUpn = upn.trim();
    const expectedOid = oid.trim();
    onCreate({
      email: parsedEmail.data,
      displayName: displayName.trim(),
      ...(expectedUpn === "" && expectedOid === ""
        ? {}
        : {
            sso: {
              ...(expectedUpn === "" ? {} : { expectedUpn }),
              ...(expectedOid === "" ? {} : { expectedOid }),
            },
          }),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onCloseAutoFocus={restoreFocusTo(returnFocusTo)}>
        <DialogHeader>
          <DialogTitle>Create password user</DialogTitle>
          <DialogDescription>
            The user finishes setup with a one-time link that you will see once.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormField label="Work email" error={errors.email}>
            {(props) => (
              <Input
                {...props}
                type="text"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Display name" error={errors.displayName}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Expected UPN (optional)"
            hint="Binds this user to an Entra account at first SSO sign-in."
          >
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                value={upn}
                onChange={(e) => setUpn(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Entra object ID (optional)">
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                value={oid}
                onChange={(e) => setOid(e.target.value)}
              />
            )}
          </FormField>
          {serverError ? <FormError>{serverError}</FormError> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The link lives in this component's props only while the dialog is open; it
// is never put in a URL, an anchor, web storage or the query cache (T24).
function SetupLinkDialog({
  link,
  onClose,
}: {
  link: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your setup link</DialogTitle>
          <DialogDescription>
            Send this link to the user. It will not be shown again and expires
            in {SETUP_EXPIRY}.
          </DialogDescription>
        </DialogHeader>
        <FormField label="Setup link">
          {(props) => (
            <Input {...props} readOnly value={link} className="font-mono" />
          )}
        </FormField>
        {copyFailed ? (
          <FormError>
            Couldn&apos;t copy automatically. Select the link and copy it.
          </FormError>
        ) : null}
        {copied ? <FormStatus>Link copied.</FormStatus> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void copy()}>
            <Copy aria-hidden />
            Copy link
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// A REAUTH_REQUIRED raises the step-up dialog instead of an inline error; only
// the second one in a row (not recent after a step-up) is shown as text.
function errorText(error: unknown, notRecent: boolean): string | null {
  if (!isReauthRequired(error)) return accessErrorMessage(error);
  return notRecent ? NOT_RECENT : null;
}

function PasswordSignInSwitch({
  canEdit,
  onWriteError,
  notRecent,
  onWritten,
}: {
  canEdit: boolean;
  onWriteError: (error: unknown) => void;
  notRecent: boolean;
  onWritten: () => void;
}) {
  const queryClient = useQueryClient();
  const state = sectionData(
    useQuery({
      queryKey: ["access", "password-sign-in"],
      queryFn: () =>
        fetchApi("/api/governance/password-sign-in", PasswordSignInSchema),
    }),
  );
  const toggle = useMutation({
    mutationFn: (next: { enabled: boolean; version: number }) =>
      mutateApi(
        "/api/governance/password-sign-in",
        "PUT",
        next,
        PasswordSignInSchema,
      ),
    onSuccess: onWritten,
    onError: onWriteError,
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["access", "password-sign-in"],
      }),
  });
  if (state === undefined) return <Skeleton className="h-8 w-64" />;

  return (
    <div className="flex max-w-[72ch] flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          aria-labelledby="password-sign-in-label"
          disabled={!canEdit || toggle.isPending}
          onClick={() => {
            toggle.reset();
            toggle.mutate({ enabled: !state.enabled, version: state.version });
          }}
          className={cn(
            "focus-visible:ring-ring/50 relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
            state.enabled ? "bg-primary" : "bg-input",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "bg-background pointer-events-none block size-5 rounded-full shadow transition-transform",
              state.enabled ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </button>
        <span id="password-sign-in-label" className="text-sm font-medium">
          Password sign-in
        </span>
      </div>
      <p className="text-muted-foreground text-sm">
        When off, only Microsoft Entra ID sign-in works. It can only be turned
        off once Entra is configured.
      </p>
      {toggle.isError ? (
        <FormError>{errorText(toggle.error, notRecent)}</FormError>
      ) : null}
    </div>
  );
}

export function PasswordUsersSection({
  canEdit,
  authMethod,
  stepUp,
}: {
  canEdit: boolean;
  authMethod: AccessViewer["authMethod"];
  stepUp: StepUpActions;
}) {
  const queryClient = useQueryClient();
  const users = sectionData(
    useQuery({
      queryKey: ["access", "password-users"],
      queryFn: () =>
        fetchAllPages("/api/password-users", PasswordUserListItemSchema),
    }),
  );
  const createButton = useRef<HTMLButtonElement>(null);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [setupLink, setSetupLink] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  // True once a step-up has completed in this view: a REAUTH_REQUIRED after it
  // is an error, not another prompt (D33). The write is never auto-replayed.
  const [steppedUp, setSteppedUp] = useState(false);
  const [notRecent, setNotRecent] = useState(false);

  function onWriteError(error: unknown) {
    if (!isReauthRequired(error)) return;
    if (steppedUp) setNotRecent(true);
    else setStepUpOpen(true);
  }
  function onWritten() {
    setSteppedUp(false);
    setNotRecent(false);
  }

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["access", "password-users"] });
  const userPath = (email: string) => `/api/password-users/${idPath(email)}`;

  // The setup link is read once from the response and kept out of the cache.
  const create = useMutation({
    gcTime: 0,
    mutationFn: (input: unknown) =>
      mutateApi(
        "/api/password-users",
        "POST",
        input,
        PasswordUserWithLinkSchema,
      ),
    onError: onWriteError,
    onSuccess: (data) => {
      onWritten();
      setCreating(false);
      setSetupLink(data.setupLink);
      void refresh();
    },
  });
  const resetPassword = useMutation({
    gcTime: 0,
    mutationFn: (user: PasswordUserListItem) =>
      mutateApi(
        `${userPath(user.email)}/reset`,
        "POST",
        undefined,
        PasswordUserWithLinkSchema,
      ),
    onError: onWriteError,
    onSuccess: (data) => {
      onWritten();
      setDialog(null);
      setSetupLink(data.setupLink);
      void refresh();
    },
  });
  const resetTotp = useMutation({
    mutationFn: (user: PasswordUserListItem) =>
      mutateApi(
        `${userPath(user.email)}/totp-reset`,
        "POST",
        undefined,
        IgnoredSchema,
      ),
    onError: onWriteError,
    onSuccess: (_data, user) => {
      onWritten();
      setDialog(null);
      setNotice(
        `Authenticator reset for ${user.email}. They enrol a new one at their next sign-in.`,
      );
      void refresh();
    },
  });
  const setEnabled = useMutation({
    mutationFn: (input: { user: PasswordUserListItem; enabled: boolean }) =>
      mutateApi(
        userPath(input.user.email),
        "PATCH",
        { enabled: input.enabled, version: input.user.version },
        IgnoredSchema,
      ),
    onSuccess: () => {
      setRowError(null);
      void refresh();
    },
    onError: (error) => {
      setRowError(accessErrorMessage(error));
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (user: PasswordUserListItem) =>
      mutateApi(
        userPath(user.email),
        "DELETE",
        { version: user.version },
        IgnoredSchema,
      ),
    onSuccess: () => {
      onWritten();
      setDialog(null);
      void refresh();
    },
    onError: (error) => {
      onWriteError(error);
      void refresh();
    },
  });

  if (users === undefined) return <Skeleton className="h-48 w-full" />;

  function open(next: Dialogs) {
    resetPassword.reset();
    resetTotp.reset();
    remove.reset();
    setNotice(null);
    setDialog(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <PasswordSignInSwitch
        canEdit={canEdit}
        onWriteError={onWriteError}
        notRecent={notRecent}
        onWritten={onWritten}
      />

      {canEdit ? (
        <div>
          <Button
            ref={createButton}
            type="button"
            size="sm"
            onClick={() => {
              create.reset();
              setCreating(true);
            }}
          >
            <Plus aria-hidden />
            Create password user
          </Button>
        </div>
      ) : null}

      {users.length === 0 ? (
        <EmptyState title="No password users yet." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Authenticator</TableHead>
              {canEdit ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.email}>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{user.displayName}</span>
                    <span className="text-muted-foreground text-xs">
                      {user.email}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{STATUS_LABELS[user.status]}</Badge>
                </TableCell>
                <TableCell>
                  {user.totpEnrolled ? "Enrolled" : "Not enrolled"}
                </TableCell>
                {canEdit ? (
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {user.status !== "sso-bound" ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Reset password for ${user.email}`}
                            onClick={() =>
                              open({ kind: "reset-password", user })
                            }
                          >
                            <KeyRound aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Reset authenticator for ${user.email}`}
                            onClick={() => open({ kind: "reset-totp", user })}
                          >
                            <ShieldOff aria-hidden />
                          </Button>
                        </>
                      ) : null}
                      {user.status === "enabled" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Disable ${user.email}`}
                          disabled={setEnabled.isPending}
                          onClick={() =>
                            setEnabled.mutate({ user, enabled: false })
                          }
                        >
                          <UserX aria-hidden />
                        </Button>
                      ) : null}
                      {user.status === "disabled" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Enable ${user.email}`}
                          disabled={setEnabled.isPending}
                          onClick={() =>
                            setEnabled.mutate({ user, enabled: true })
                          }
                        >
                          <UserCheck aria-hidden />
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${user.email}`}
                        onClick={() => open({ kind: "delete", user })}
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

      {rowError ? <FormError>{rowError}</FormError> : null}
      {notice ? <FormStatus>{notice}</FormStatus> : null}

      {creating ? (
        <CreateDialog
          returnFocusTo={createButton}
          pending={create.isPending}
          serverError={
            create.isError ? errorText(create.error, notRecent) : null
          }
          onCreate={(input) => {
            setNotRecent(false);
            create.mutate(input);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {setupLink ? (
        <SetupLinkDialog link={setupLink} onClose={() => setSetupLink(null)} />
      ) : null}
      {dialog?.kind === "reset-password" ? (
        <ConfirmDialog
          title="Reset password"
          description={`Reset the password for ${dialog.user.email}? The old setup link and password stop working, and you get a new one-time setup link.`}
          confirmLabel="Reset password"
          destructive={false}
          pending={resetPassword.isPending}
          error={
            resetPassword.isError
              ? errorText(resetPassword.error, notRecent)
              : null
          }
          onConfirm={() => {
            setNotRecent(false);
            resetPassword.mutate(dialog.user);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "reset-totp" ? (
        <ConfirmDialog
          title="Reset authenticator"
          description={`Remove the authenticator for ${dialog.user.email}? They enrol a new one at their next sign-in.`}
          confirmLabel="Reset authenticator"
          destructive={false}
          pending={resetTotp.isPending}
          error={
            resetTotp.isError ? errorText(resetTotp.error, notRecent) : null
          }
          onConfirm={() => {
            setNotRecent(false);
            resetTotp.mutate(dialog.user);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          title="Delete password user"
          description={`Delete ${dialog.user.email}? They can no longer sign in with a password.`}
          confirmLabel="Delete"
          pending={remove.isPending}
          error={remove.isError ? errorText(remove.error, notRecent) : null}
          onConfirm={() => {
            setNotRecent(false);
            remove.mutate(dialog.user);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {stepUpOpen ? (
        <StepUpDialog
          authMethod={authMethod}
          stepUp={stepUp}
          section="password-users"
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
