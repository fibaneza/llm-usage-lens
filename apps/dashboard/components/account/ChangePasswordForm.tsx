"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  FormError,
  FormField,
  FormStatus,
} from "@/components/settings/access/form-controls";
import { IgnoredSchema } from "@/components/settings/access/access-schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkPassword } from "@/lib/auth/password-policy";
import { mutateApi } from "@/lib/query/fetch-api";

// Source: temp/run-r4b/decisions.md F9; docs/specs/2026-11-10-access-control.md
// - "Password users" (Passwords: 12-128 characters, no composition rules,
// common list; TOTP D23), "API routes (additions)" (POST /api/account/password:
// current password and, when enrolled, the TOTP code). Any refusal shows one
// generic message that never echoes the server, so it cannot confirm which
// factor was wrong.
const POLICY_MESSAGES = {
  "too-short": "Password must be at least 12 characters.",
  "too-long": "Password must be at most 128 characters.",
  common: "That password is too common. Choose another.",
} as const;
const REFUSED =
  "Could not change the password. Check your current password and code, then try again.";

export function ChangePasswordForm({
  totpEnrolled,
}: {
  totpEnrolled: boolean;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  function invalid(): string | null {
    if (current === "") return "Enter your current password.";
    const verdict = checkPassword(next);
    if (verdict !== "ok") return POLICY_MESSAGES[verdict];
    if (next !== confirm) return "The passwords do not match.";
    if (totpEnrolled && !/^\d{6}$/.test(code.trim())) {
      return "Enter the 6-digit code from your authenticator app.";
    }
    return null;
  }

  function edit(set: (value: string) => void, value: string) {
    setChanged(false);
    set(value);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    // A repeat submit of a form that just succeeded (fields cleared, nothing
    // edited since) is a double click, not a new attempt.
    if (submitting.current || changed) return;
    const problem = invalid();
    if (problem) return setError(problem);

    setError(null);
    submitting.current = true;
    setPending(true);
    try {
      await mutateApi(
        "/api/account/password",
        "POST",
        {
          currentPassword: current,
          newPassword: next,
          ...(totpEnrolled ? { totp: code.trim() } : {}),
        },
        IgnoredSchema,
      );
      setCurrent("");
      setNext("");
      setConfirm("");
      setCode("");
      setChanged(true);
    } catch {
      setError(REFUSED);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Change password"
      className="flex max-w-[72ch] flex-col gap-4"
    >
      <FormField label="Current password">
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => edit(setCurrent, e.target.value)}
          />
        )}
      </FormField>
      <FormField label="New password">
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => edit(setNext, e.target.value)}
          />
        )}
      </FormField>
      <FormField label="Confirm new password">
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => edit(setConfirm, e.target.value)}
          />
        )}
      </FormField>
      {totpEnrolled ? (
        <FormField label="Authenticator code">
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => edit(setCode, e.target.value)}
            />
          )}
        </FormField>
      ) : null}
      {error ? <FormError>{error}</FormError> : null}
      {changed ? <FormStatus>Password changed.</FormStatus> : null}
      <div>
        <Button type="submit" disabled={pending}>
          Change password
        </Button>
      </div>
    </form>
  );
}
