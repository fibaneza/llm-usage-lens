"use client";

import {
  CreateLiteLLMUserResultSchema,
  LINK_REASON_MAX,
  LiteLLMLinkResultSchema,
  LiteLLMUserSearchResponseSchema,
} from "@llm-usage-lens/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link2, Link2Off, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";

import { FieldHelp } from "@/components/display/FieldHelp";
import { accessErrorMessage } from "@/components/settings/access/access-error-message";
import {
  FormError,
  FormField,
  NativeTextarea,
} from "@/components/settings/access/form-controls";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { SearchInput } from "@/components/table/SearchInput";
import { ApiRequestError, fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: Design System - Management improvements, "User link states" (D16);
// Access Control - "LiteLLM user links". The server decides every write
// (admin and org-admin, never the caller's own oid, a reason on a manual link,
// OSS-only create); this renders the controls only to a caller who may use
// them and never links by itself (Access Control D27).
export type LinkSubject = {
  oid: string;
  name: string;
  email: string | null;
  // The IdentityLink version the write must send (0: no link yet).
  version: number;
};

export type LinkState =
  | { state: "linked"; litellmUserId: string }
  | { state: "match"; litellmUserId: string; email: string }
  | { state: "none" };

export const CREATE_LITELLM_USER_LABEL = "Create LiteLLM user";

const MIN_TERM = 2;
const DEBOUNCE_MS = 400;

function linkErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "PRIVILEGED_TARGET") {
      return "That LiteLLM user is an administrator account and cannot be linked.";
    }
    if (error.code === "OPERATION_UNAVAILABLE") {
      return "This LiteLLM edition does not create users. Sign in to LiteLLM once, then retry.";
    }
    if (error.code === "OPERATION_DISABLED") {
      return "This operation is switched off.";
    }
  }
  return accessErrorMessage(error);
}

const linkPath = (oid: string) =>
  `/api/identities/${encodeURIComponent(oid)}/litellm-link`;

function ConfirmMatch({
  subject,
  match,
  onClose,
  onChanged,
}: {
  subject: LinkSubject;
  match: { litellmUserId: string; email: string };
  onClose: () => void;
  onChanged: () => void;
}) {
  const link = useMutation({
    mutationFn: () =>
      mutateApi(
        linkPath(subject.oid),
        "PUT",
        {
          litellmUserId: match.litellmUserId,
          mode: "match",
          version: subject.version,
        },
        LiteLLMLinkResultSchema,
      ),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Link to this LiteLLM user?</AlertDialogTitle>
          <AlertDialogDescription>
            App user {subject.name}
            {subject.email ? ` (${subject.email})` : ""} will be linked to
            LiteLLM user {match.email}. Their emails match; nothing is linked
            until you confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {link.isError ? (
          <FormError>{linkErrorMessage(link.error)}</FormError>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            disabled={link.isPending}
            onClick={() => link.mutate()}
          >
            Link
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmUnlink({
  subject,
  litellmUserId,
  onClose,
  onChanged,
}: {
  subject: LinkSubject;
  litellmUserId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const unlink = useMutation({
    mutationFn: () =>
      mutateApi(
        linkPath(subject.oid),
        "DELETE",
        { version: subject.version },
        LiteLLMLinkResultSchema,
      ),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this link?</AlertDialogTitle>
          <AlertDialogDescription>
            App user {subject.name} will no longer be linked to LiteLLM user{" "}
            {litellmUserId}. The LiteLLM user is not deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {unlink.isError ? (
          <FormError>{linkErrorMessage(unlink.error)}</FormError>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={unlink.isPending}
            onClick={() => unlink.mutate()}
          >
            Remove link
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmCreate({
  subject,
  onClose,
  onChanged,
}: {
  subject: LinkSubject;
  onClose: () => void;
  onChanged: () => void;
}) {
  const create = useMutation({
    mutationFn: () =>
      mutateApi(
        "/api/litellm/users",
        "POST",
        { oid: subject.oid },
        CreateLiteLLMUserResultSchema,
      ),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Create a LiteLLM user and link?</AlertDialogTitle>
          <AlertDialogDescription>
            This creates a LiteLLM user for {subject.email ?? subject.name}{" "}
            (without a key) and links {subject.name} to it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {create.isError ? (
          <FormError>{linkErrorMessage(create.error)}</FormError>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            {CREATE_LITELLM_USER_LABEL}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LinkExistingDialog({
  subject,
  onClose,
  onChanged,
}: {
  subject: LinkSubject;
  onClose: () => void;
  onChanged: () => void;
}) {
  const groupId = useId();
  const hintId = useId();
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const active = term.length >= MIN_TERM;
  const results = useQuery({
    queryKey: ["litellm", "link-pick", term],
    enabled: active,
    queryFn: () =>
      fetchApi(
        `/api/litellm/users?q=${encodeURIComponent(term)}`,
        LiteLLMUserSearchResponseSchema,
      ),
  });
  const link = useMutation({
    mutationFn: (body: { litellmUserId: string; reason: string }) =>
      mutateApi(
        linkPath(subject.oid),
        "PUT",
        { ...body, mode: "manual", version: subject.version },
        LiteLLMLinkResultSchema,
      ),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = reason.trim();
    if (text.length < 1 || text.length > LINK_REASON_MAX) {
      setReasonError(`Give a reason of 1 to ${LINK_REASON_MAX} characters`);
      return;
    }
    setReasonError(null);
    if (picked === null) return;
    link.mutate({ litellmUserId: picked, reason: text });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link to an existing LiteLLM user</DialogTitle>
          <DialogDescription>
            Link {subject.name}
            {subject.email ? ` (${subject.email})` : ""} to a LiteLLM user whose
            email differs. A written reason is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <SearchInput
            label="Search LiteLLM users"
            placeholder="Email or user id"
            maxLength={100}
            delayMs={0}
            autoComplete="off"
            describedBy={hintId}
            value={input}
            onChange={(value) => {
              setInput(value);
              setPicked(null);
            }}
          />
          <p id={hintId} className="text-muted-foreground -mt-3 text-xs">
            Email or user id.
          </p>
          {active ? (
            results.isPending ? (
              <p role="status" className="text-muted-foreground text-sm">
                Searching...
              </p>
            ) : results.isError ? (
              <FormError>{linkErrorMessage(results.error)}</FormError>
            ) : results.data.users.length === 0 ? (
              <p className="text-muted-foreground text-sm">No users found</p>
            ) : (
              <fieldset className="flex flex-col gap-1">
                <legend className="text-sm font-medium">
                  LiteLLM user to link
                </legend>
                {results.data.users.map((user) => (
                  <label
                    key={user.userId}
                    className="min-h-touch flex items-center gap-2 text-sm md:min-h-0"
                  >
                    <input
                      type="radio"
                      name={groupId}
                      checked={picked === user.userId}
                      onChange={() => setPicked(user.userId)}
                    />
                    <span className="break-all">{user.email}</span>
                  </label>
                ))}
              </fieldset>
            )
          ) : null}
          <FormField label="Reason" error={reasonError ?? undefined}>
            {(props) => (
              <NativeTextarea
                {...props}
                maxLength={LINK_REASON_MAX}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </FormField>
          {link.isError ? (
            <FormError>{linkErrorMessage(link.error)}</FormError>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={link.isPending || picked === null}>
              Link user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Open = "match" | "unlink" | "create" | "existing" | null;

// One row's link state and, for a caller who may write, its actions. `canWrite`
// is false for the auditor and on the caller's own row (the parent decides).
export function LiteLLMLinkCell({
  subject,
  link,
  canWrite,
  canCreate,
  onChanged,
  showState = true,
  userHref,
}: {
  subject: LinkSubject;
  link: LinkState;
  canWrite: boolean;
  // `createUser` is on and this edition creates users (OSS).
  canCreate: boolean;
  onChanged: () => void;
  // false: the actions only; the state is shown elsewhere (LiteLLM users tab
  // rows, Design System LF1 D-LF4).
  showState?: boolean;
  // The linked LiteLLM user id links to its page (T-LP10), for the three
  // LiteLLM-reading roles only.
  userHref?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  return (
    <div className="flex flex-col items-start gap-1.5">
      {link.state === "linked" ? (
        <>
          {showState ? (
            <>
              <Badge variant="secondary">Linked</Badge>
              {userHref ? (
                <Link
                  href={userHref}
                  className="text-xs break-all underline-offset-4 hover:underline"
                >
                  {link.litellmUserId}
                </Link>
              ) : (
                <span className="text-muted-foreground text-xs break-all">
                  {link.litellmUserId}
                </span>
              )}
            </>
          ) : null}
          {canWrite ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpen("unlink")}
            >
              <Link2Off aria-hidden />
              Unlink
            </Button>
          ) : null}
        </>
      ) : null}
      {link.state === "match" ? (
        <>
          {showState ? (
            <span className="text-muted-foreground text-xs break-all">
              {link.email}
            </span>
          ) : null}
          {canWrite ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                onClick={() => setOpen("match")}
                aria-label={`Link ${subject.name} to ${link.email}`}
              >
                <Link2 aria-hidden />
                Link
              </Button>
              <FieldHelp field="Link (a match)">
                A LiteLLM user has the same email. Link connects the two after
                you confirm.
              </FieldHelp>
            </div>
          ) : null}
        </>
      ) : null}
      {link.state === "none" ? (
        <>
          {showState ? (
            <Badge variant="outline">No LiteLLM user with that email</Badge>
          ) : null}
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setOpen("existing")}
                >
                  <Link2 aria-hidden />
                  Link to an existing LiteLLM user
                </Button>
                <FieldHelp field="Link to an existing LiteLLM user">
                  Connects this person to a LiteLLM user that already exists, so
                  their LiteLLM spend shows here. Nothing changes in LiteLLM.
                </FieldHelp>
              </div>
              {canCreate ? (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setOpen("create")}
                  >
                    <UserPlus aria-hidden />
                    {CREATE_LITELLM_USER_LABEL}
                  </Button>
                  <FieldHelp field={CREATE_LITELLM_USER_LABEL}>
                    Creates a user in LiteLLM with this person&apos;s email and
                    links it to this person. It sets no team, key or budget.
                  </FieldHelp>
                </div>
              ) : null}
            </div>
          ) : null}
          {canWrite && !canCreate ? (
            <p className="text-muted-foreground text-xs">
              Sign in to LiteLLM once, then retry.
            </p>
          ) : null}
        </>
      ) : null}
      {open === "match" && link.state === "match" ? (
        <ConfirmMatch
          subject={subject}
          match={link}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
      {open === "unlink" && link.state === "linked" ? (
        <ConfirmUnlink
          subject={subject}
          litellmUserId={link.litellmUserId}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
      {open === "create" ? (
        <ConfirmCreate
          subject={subject}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
      {open === "existing" ? (
        <LinkExistingDialog
          subject={subject}
          onClose={close}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}
