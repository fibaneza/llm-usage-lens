"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { accessErrorMessage } from "@/components/settings/access/access-error-message";
import {
  idPath,
  useOrgUnits,
} from "@/components/settings/access/access-queries";
import { IgnoredSchema } from "@/components/settings/access/access-schemas";
import {
  FormError,
  FormField,
  NativeSelect,
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
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError, mutateApi } from "@/lib/query/fetch-api";

// Source: Design System - Management -> Users, "Placing a person by hand"
// (INV2: the picker lists the teams the server returns for the caller; each
// action confirms naming the person and the team, Cancel focused first);
// Access Control - "Placing a person by hand" (Add to team: POST
// /api/teams/[id]/members { oid }; Invite: { emailOrUpn }). The picker is a
// convenience; the route answers 403 again (T-IV6).
export type TeamPickerAction =
  | { kind: "add"; oid: string }
  | { kind: "invite"; email: string };

export function TeamPickerDialog({
  action,
  personName,
  onClose,
  onDone,
}: {
  action: TeamPickerAction;
  personName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const units = useOrgUnits();
  const [teamId, setTeamId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const teams = units.data?.teams ?? [];
  const chosen = teams.find((t) => t.id === teamId) ?? null;
  const verb = action.kind === "add" ? "Add to team" : "Invite";

  const write = useMutation({
    mutationFn: (id: string) =>
      mutateApi(
        `/api/teams/${idPath(id)}/members`,
        "POST",
        action.kind === "add"
          ? { oid: action.oid }
          : { emailOrUpn: action.email },
        IgnoredSchema,
      ),
    onSuccess: onDone,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`${verb}: ${personName}`}</DialogTitle>
          <DialogDescription>
            Choose the team. You confirm before anything is sent.
          </DialogDescription>
        </DialogHeader>
        {units.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : units.isError ? (
          <FormError>{accessErrorMessage(units.error)}</FormError>
        ) : teams.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            There is no team you can add people to.
          </p>
        ) : (
          <FormField label="Team">
            {(props) => (
              <NativeSelect
                {...props}
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value="">Select a team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
        {write.isError ? (
          <FormError>
            {write.error instanceof ApiRequestError
              ? write.error.message
              : accessErrorMessage(write.error)}
          </FormError>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={chosen === null || write.isPending}
            onClick={() => {
              write.reset();
              setConfirming(true);
            }}
          >
            Continue
          </Button>
        </DialogFooter>
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{`${verb}?`}</AlertDialogTitle>
              <AlertDialogDescription>
                {action.kind === "add"
                  ? `Adds ${personName} to ${chosen?.name ?? "the team"}. Recorded in the audit log.`
                  : `Invites ${personName} to ${chosen?.name ?? "the team"}; they join when they first sign in. Recorded in the audit log.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (chosen) write.mutate(chosen.id);
                }}
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
