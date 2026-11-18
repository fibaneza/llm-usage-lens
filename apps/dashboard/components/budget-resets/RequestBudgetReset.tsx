"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  useCreateBudgetResetRequest,
  useMyBudgetResetRequests,
} from "./use-budget-reset-requests";

const MAX_REASON = 280;

const dateOf = (iso: string) => iso.slice(0, 10);

// Source: docs/specs/2026-11-10-litellm.md -- "Budget reset requests"
// (MG-D8 to MG-D13). Hidden, never dead: nothing renders unless the server
// says the caller can request. The reason is shown back as text only (BR7).
export function RequestBudgetReset() {
  const mine = useMyBudgetResetRequests();
  const create = useCreateBudgetResetRequest();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const data = mine.data;
  if (data === undefined) return null;

  const pending = data.open ?? create.data ?? null;
  if (pending !== null) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <p className="text-muted-foreground">
          {`Budget reset requested ${dateOf(pending.createdAt)} — waiting for your team lead`}
        </p>
        {pending.reason === null ? null : (
          <p className="text-muted-foreground max-w-[72ch] whitespace-pre-wrap">
            {pending.reason}
          </p>
        )}
      </div>
    );
  }

  if (!data.eligibility.canRequest) return null;

  const trimmed = reason.trim();
  const submit = () => {
    create.mutate(trimmed === "" ? undefined : trimmed, {
      onSuccess: () => {
        setOpen(false);
        setReason("");
      },
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-primary text-sm font-medium underline-offset-4 hover:underline"
      >
        Request a budget reset
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) create.reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a budget reset</DialogTitle>
            <DialogDescription>
              Your team lead is asked to reset your spend to $0.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm font-medium">
            Reason (optional)
            <textarea
              value={reason}
              maxLength={MAX_REASON}
              rows={4}
              onChange={(e) => setReason(e.target.value)}
              className="rounded-control border-input focus-visible:ring-focus-ring focus-visible:ring-offset-background border bg-transparent px-3 py-2 text-base font-normal outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2 md:text-sm"
            />
            <span className="text-muted-foreground text-xs font-normal">
              {`${reason.length}/${MAX_REASON}`}
            </span>
          </label>
          {create.error === null ? null : (
            <p role="alert" className="text-destructive text-sm">
              {create.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={create.isPending} onClick={submit}>
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
