"use client";

import { GrantableRoleSchema } from "@llm-usage-lens/shared";
import type { GrantableRole } from "@llm-usage-lens/shared";
import { useState } from "react";
import type { FormEvent } from "react";

import {
  FormError,
  FormField,
  NativeSelect,
  NativeTextarea,
} from "@/components/settings/access/form-controls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ROLE_LABELS } from "@/lib/auth/roles";

// POST /api/role-grants for this person: a role and a required reason that is
// recorded in the audit log (Access Control - Roles). No person picker.
const MAX_REASON = 500;

export function GrantRoleDialog({
  pending,
  serverError,
  onGrant,
  onClose,
}: {
  pending: boolean;
  serverError: string | null;
  onGrant: (role: GrantableRole, reason: string) => void;
  onClose: () => void;
}) {
  const [role, setRole] = useState<GrantableRole>("internal-org-admin");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | undefined>();

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = reason.trim();
    if (text === "") {
      setProblem("Reason is required");
      return;
    }
    if (text.length > MAX_REASON) {
      setProblem(`Reason must be ${MAX_REASON} characters or fewer`);
      return;
    }
    setProblem(undefined);
    onGrant(role, text);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant role</DialogTitle>
          <DialogDescription>
            The reason is recorded in the audit log with this grant.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormField label="Role">
            {(props) => (
              <NativeSelect
                {...props}
                value={role}
                onChange={(e) =>
                  setRole(GrantableRoleSchema.parse(e.target.value))
                }
              >
                {GrantableRoleSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField label="Reason" error={problem}>
            {(props) => (
              <NativeTextarea
                {...props}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
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
