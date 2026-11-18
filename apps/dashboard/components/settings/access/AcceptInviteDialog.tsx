"use client";

import { InviteCandidateSchema } from "@llm-usage-lens/shared";
import type { InviteCandidate } from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import { accessErrorMessage } from "@/components/settings/access/access-error-message";
import { idPath } from "@/components/settings/access/access-queries";
import {
  IgnoredSchema,
  pageOf,
} from "@/components/settings/access/access-schemas";
import {
  FormError,
  FormField,
  NativeTextarea,
} from "@/components/settings/access/form-controls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: docs/specs/2026-11-10-access-control.md - "Accept a pending invite
// (unit INV1)" (Target: server-computed candidates, never typed; the key shown
// against UPN and email with the mismatch marked; required reason 1-280),
// Design System - Management improvements, "Accept a pending invite". The
// route enforces the matrix and every refusal again.
const REASON_MAX = 280;

const differs = (value: string | null, key: string) =>
  value === null || value.toLowerCase() !== key.toLowerCase();

const nameOf = (c: InviteCandidate) =>
  c.displayName ?? c.email ?? c.upn ?? c.oid;

function CandidateOption({
  candidate,
  inviteKey,
  checked,
  onChoose,
}: {
  candidate: InviteCandidate;
  inviteKey: string;
  checked: boolean;
  onChoose: () => void;
}) {
  return (
    <label className="border-border flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
      <input
        type="radio"
        name="invite-candidate"
        className="mt-1"
        checked={checked}
        onChange={onChoose}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{nameOf(candidate)}</span>
        <span className="text-muted-foreground break-all">
          UPN: {candidate.upn ?? "—"}
          {differs(candidate.upn, inviteKey) ? (
            <span className="text-destructive ml-2 text-xs">UPN differs</span>
          ) : null}
        </span>
        <span className="text-muted-foreground break-all">
          Email: {candidate.email ?? "—"}
          {differs(candidate.email, inviteKey) ? (
            <span className="text-destructive ml-2 text-xs">email differs</span>
          ) : null}
        </span>
      </span>
    </label>
  );
}

export function AcceptInviteDialog({
  teamId,
  teamName,
  inviteKey,
  canSearch,
  onClose,
  onAccepted,
}: {
  teamId: string;
  teamName: string;
  inviteKey: string;
  canSearch: boolean;
  onClose: () => void;
  onAccepted: (oid: string) => void;
}) {
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [chosenOid, setChosenOid] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  const base = `/api/teams/${idPath(teamId)}/members/pending/${idPath(inviteKey)}`;
  const candidatesQuery = useQuery({
    queryKey: ["access", "invite-candidates", teamId, inviteKey, search],
    queryFn: () =>
      fetchApi(
        `${base}/candidates${search ? `?q=${encodeURIComponent(search)}` : ""}`,
        pageOf(InviteCandidateSchema),
      ),
    retry: false,
  });
  const candidates = candidatesQuery.data?.items;
  const chosen = candidates?.find((c) => c.oid === chosenOid) ?? null;
  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= 1 && trimmed.length <= REASON_MAX;

  const accept = useMutation({
    mutationFn: (input: { oid: string; reason: string }) =>
      mutateApi(`${base}/accept`, "POST", input, IgnoredSchema),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ["access"] });
      onAccepted(input.oid);
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: ["access"] }),
  });

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearch(searchText.trim());
    setChosenOid(null);
  }

  const searchBox = canSearch ? (
    <form onSubmit={submitSearch} className="flex items-end gap-2">
      <FormField label="Search people">
        {(props) => (
          <Input
            {...props}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        )}
      </FormField>
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  ) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Accept invite for {inviteKey}</DialogTitle>
          <DialogDescription>
            Pick the person who has already signed in, so they join {teamName}{" "}
            now.
          </DialogDescription>
        </DialogHeader>
        {searchBox}
        {candidates === undefined ? (
          candidatesQuery.isError ? (
            <FormError>{accessErrorMessage(candidatesQuery.error)}</FormError>
          ) : (
            <Skeleton className="h-24 w-full" />
          )
        ) : candidates.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No candidate has signed in with a matching UPN or email yet.
          </p>
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label="Candidates"
              className="flex flex-col gap-2"
            >
              {candidates.map((candidate) => (
                <CandidateOption
                  key={candidate.oid}
                  candidate={candidate}
                  inviteKey={inviteKey}
                  checked={candidate.oid === chosen?.oid}
                  onChoose={() => setChosenOid(candidate.oid)}
                />
              ))}
            </div>
            <FormField
              label="Reason"
              hint={`Recorded in the audit log (1 to ${REASON_MAX} characters).`}
            >
              {(props) => (
                <NativeTextarea
                  {...props}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </FormField>
          </>
        )}
        {accept.isError ? (
          <FormError>{accessErrorMessage(accept.error)}</FormError>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={chosen === null || !reasonValid || accept.isPending}
            onClick={() => {
              accept.reset();
              setConfirming(true);
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Add to team?</AlertDialogTitle>
              <AlertDialogDescription>
                {chosen ? nameOf(chosen) : "This person"} becomes a member of{" "}
                {teamName}, and the invitation for {inviteKey} is used up.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (chosen) accept.mutate({ oid: chosen.oid, reason });
                }}
              >
                Add to team
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
