"use client";

import { useState, type ReactNode, type RefObject } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function WriteError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}

// A destructive action confirms before the route is called (Design System --
// LiteLLM Page).
export function ConfirmAction({
  label,
  text,
  title,
  description,
  disabled,
  onConfirm,
}: {
  label: string;
  text: string;
  title: string;
  description: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={label}
          disabled={disabled}
        >
          {text}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ActionButton({
  label,
  text,
  disabled,
  onClick,
}: {
  label: string;
  text: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {text}
    </Button>
  );
}

// A form in a dialog; it closes when `onSubmit` resolves true and keeps the
// server message inline otherwise.
export function FormDialog({
  label,
  text,
  title,
  description,
  submitLabel,
  canSubmit,
  hideSubmit = false,
  pending,
  error,
  onOpen,
  onSubmit,
  triggerRef,
  children,
}: {
  label: string;
  text: string;
  title: string;
  description?: string;
  submitLabel: string;
  canSubmit: boolean;
  hideSubmit?: boolean;
  pending: boolean;
  error: string | null;
  onOpen?: () => void;
  onSubmit: () => Promise<boolean>;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpen?.();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button ref={triggerRef} variant="outline" size="sm" aria-label={label}>
          {text}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onSubmit()) setOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className={description ? undefined : "sr-only"}>
              {description ?? title}
            </DialogDescription>
          </DialogHeader>
          {children}
          <WriteError message={error} />
          <DialogFooter>
            {hideSubmit ? null : (
              <Button type="submit" disabled={!canSubmit || pending}>
                {submitLabel}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
