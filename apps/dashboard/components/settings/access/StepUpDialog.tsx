"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import {
  FormError,
  FormField,
} from "@/components/settings/access/form-controls";
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
import { Input } from "@/components/ui/input";
import type { StepUpSection } from "@/lib/auth/step-up";

// Source: docs/specs/2026-11-10-access-control.md - "Recent authentication"
// (D28): 'Confirm it's you' with the control for the session's own sign-in
// method - a button for Entra and the dev login, password and authenticator code otherwise. The
// identifier comes from the server session, never from this form; the unsent
// draft and the secrets never go in the URL or web storage; the write is not
// replayed (threat T32).
const STEP_UP_FAILED =
  "We couldn't confirm it's you. Check your details and try again.";

export function StepUpDialog({
  authMethod,
  stepUp,
  section,
  onDone,
  onClose,
}: {
  authMethod: AccessViewer["authMethod"];
  stepUp: StepUpActions;
  section: StepUpSection;
  // The step-up ran without leaving the page; the caller lets the admin submit
  // the write again.
  onDone: () => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => ReturnType<StepUpActions["entra"]>) {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (result?.ok === false) {
        setError(STEP_UP_FAILED);
        return;
      }
      onDone();
    } catch {
      // A thrown redirect leaves the page; any other failure is the one
      // generic message (no detail that helps an attacker).
      setError(STEP_UP_FAILED);
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() => stepUp.credentials(form, section));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm it&apos;s you</DialogTitle>
          <DialogDescription>
            This change needs a sign-in from the last 15 minutes. Confirm, then
            submit it again.
          </DialogDescription>
        </DialogHeader>
        {authMethod === "entra" ? (
          <>
            {error ? <FormError>{error}</FormError> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() => void run(() => stepUp.entra(section))}
              >
                Confirm with Microsoft
              </Button>
            </DialogFooter>
          </>
        ) : authMethod === "local" ? (
          <>
            {error ? <FormError>{error}</FormError> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() => void run(() => stepUp.devLogin(section))}
              >
                Confirm with dev login
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FormField label="Password">
              {(props) => (
                <Input
                  {...props}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                />
              )}
            </FormField>
            <FormField label="Authenticator code">
              {(props) => (
                <Input
                  {...props}
                  name="totp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
              )}
            </FormField>
            {error ? <FormError>{error}</FormError> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                Confirm
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
