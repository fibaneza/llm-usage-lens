"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ApproveBudgetResetResponseSchema,
  DenyBudgetResetResponseSchema,
} from "@llm-usage-lens/shared";
import type { BudgetResetRequestView } from "@llm-usage-lens/shared";
import { useState } from "react";
import type { MouseEvent } from "react";

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
import { mutateApi } from "@/lib/query/fetch-api";

import { NOTIFICATIONS_KEY } from "./use-notifications";

// Source: docs/specs/2026-11-10-litellm.md — MG-D11/MG-D12 (Approve names the
// person and the effect; a decision re-reads the request on the server, so a
// 403/404/409 is shown as the server's message); Rule 40.9 (one filled
// primary button per view: Approve is filled only inside its dialog).
type Decision = "approve" | "deny";

export const BUDGET_RESET_REQUESTS_KEY = ["budget-reset-requests"] as const;

const personName = (request: BudgetResetRequestView): string =>
  request.requester.displayName ?? request.requester.email ?? "this person";

export function DecisionButtons({
  request,
  onDone,
  approveDisabledReason,
}: {
  request: BudgetResetRequestView;
  onDone?: () => void;
  approveDisabledReason?: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Decision | null>(null);
  const name = personName(request);
  const team = request.teamName ?? "their team";

  const decide = useMutation({
    mutationFn: (decision: Decision) =>
      decision === "approve"
        ? mutateApi(
            `/api/budget-reset-requests/${request.id}/approve`,
            "POST",
            undefined,
            ApproveBudgetResetResponseSchema,
          )
        : mutateApi(
            `/api/budget-reset-requests/${request.id}/deny`,
            "POST",
            undefined,
            DenyBudgetResetResponseSchema,
          ),
    onSuccess: async () => {
      setOpen(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
        queryClient.invalidateQueries({ queryKey: BUDGET_RESET_REQUESTS_KEY }),
      ]);
      onDone?.();
    },
  });

  const close = (next: boolean) => {
    if (!next && !decide.isPending) {
      setOpen(null);
      decide.reset();
    }
  };

  const confirm = (decision: Decision) => (event: MouseEvent) => {
    event.preventDefault();
    decide.mutate(decision);
  };

  const error = decide.error instanceof Error ? decide.error.message : null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={approveDisabledReason !== undefined}
          onClick={() => setOpen("approve")}
        >
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen("deny")}
        >
          Deny
        </Button>
        {approveDisabledReason === undefined ? null : (
          <span className="text-muted-foreground w-full text-xs">
            {approveDisabledReason}
          </span>
        )}
      </div>

      <AlertDialog open={open === "approve"} onOpenChange={close}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset budget for {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Reset {name}&apos;s spend in {team} to $0. They can spend again at
              once.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={decide.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={decide.isPending}
              onClick={confirm("approve")}
            >
              {decide.isPending ? "Approving…" : "Approve reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={open === "deny"} onOpenChange={close}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deny the request from {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {name} is told the request was denied. Their spend in {team} is
              not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={decide.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="secondary"
              disabled={decide.isPending}
              onClick={confirm("deny")}
            >
              {decide.isPending ? "Denying…" : "Deny request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
