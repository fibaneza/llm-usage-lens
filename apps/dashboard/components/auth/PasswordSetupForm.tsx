"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { checkPassword } from "@/lib/auth/password-policy";

// Source: docs/specs/2026-11-10-access-control.md - "Password users" (Setup
// D22: the token is read from the URL fragment, which never reaches a server
// log, and is never rendered; Passwords: 12-128 characters, no composition
// rules, common list; TOTP D23), threats T24, T25. One generic error for any
// refused link.
type Preview = { email: string; displayName: string; totpRequired: boolean };

type PasswordSetupFormProps = {
  totpSecret: string;
  previewAction: (token: string) => Promise<Preview | null>;
  setupAction: (formData: FormData) => Promise<{ ok: false } | void>;
};

type LinkState =
  | { status: "checking" }
  | { status: "invalid" }
  | { status: "ready"; preview: Preview };

const INVALID_LINK = "This setup link is invalid or has expired.";
const FIELD_CLASS =
  "border-border bg-background text-foreground ring-ring rounded-md border px-3 py-2 outline-none focus-visible:ring-2";
const ALERT_CLASS = "text-destructive text-sm";

const POLICY_MESSAGES = {
  "too-short": "Password must be at least 12 characters.",
  "too-long": "Password must be at most 128 characters.",
  common: "That password is too common. Choose another.",
} as const;

export function PasswordSetupForm({
  totpSecret,
  previewAction,
  setupAction,
}: PasswordSetupFormProps) {
  const [link, setLink] = useState<LinkState>({ status: "checking" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const token = useRef("");
  const submitting = useRef(false);

  useEffect(() => {
    let cancelled = false;
    token.current = window.location.hash.slice(1);
    if (!token.current) {
      setLink({ status: "invalid" });
      return;
    }
    previewAction(token.current).then(
      (preview) => {
        if (!cancelled) {
          setLink(
            preview ? { status: "ready", preview } : { status: "invalid" },
          );
        }
      },
      () => {
        if (!cancelled) setLink({ status: "invalid" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [previewAction]);

  if (link.status === "checking") {
    return (
      <p
        role="status"
        className="text-muted-foreground flex items-center gap-2 text-sm"
      >
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Checking your setup link...
      </p>
    );
  }

  if (link.status === "invalid") {
    return (
      <p role="alert" className={ALERT_CLASS}>
        {INVALID_LINK}
      </p>
    );
  }

  const { preview } = link;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");
    const code = String(data.get("totpCode") ?? "").trim();

    const verdict = checkPassword(password);
    if (verdict !== "ok") return setError(POLICY_MESSAGES[verdict]);
    if (password !== confirm) return setError("The passwords do not match.");
    if ((preview.totpRequired || code) && !/^\d{6}$/.test(code)) {
      return setError("Enter the 6-digit code from your authenticator app.");
    }

    const form = new FormData();
    form.set("token", token.current);
    form.set("password", password);
    form.set("totpSecret", totpSecret);
    form.set("totpCode", code);

    setError(null);
    submitting.current = true;
    setPending(true);
    try {
      const result = await setupAction(form);
      if (result && result.ok === false) setError(INVALID_LINK);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex w-full max-w-[72ch] flex-col gap-4 text-left"
    >
      <p className="text-foreground text-sm">
        Choose a password for <strong>{preview.email}</strong>.
      </p>
      <label className="text-foreground flex flex-col gap-1 text-sm">
        New password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className={FIELD_CLASS}
        />
      </label>
      <label className="text-foreground flex flex-col gap-1 text-sm">
        Confirm new password
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          className={FIELD_CLASS}
        />
      </label>
      <fieldset className="border-border flex flex-col gap-2 rounded-md border p-4">
        <legend className="text-foreground px-1 text-sm font-medium">
          Authenticator app
        </legend>
        <p className="text-muted-foreground text-sm">
          Add this key to your authenticator app, then enter the 6-digit code it
          shows.
        </p>
        <code className="bg-muted text-foreground rounded-md px-3 py-2 font-mono text-sm break-all">
          {totpSecret}
        </code>
        <label className="text-foreground flex flex-col gap-1 text-sm">
          {preview.totpRequired
            ? "Authenticator code"
            : "Authenticator code (optional)"}
          <input
            name="totpCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            required={preview.totpRequired}
            className={FIELD_CLASS}
          />
        </label>
      </fieldset>
      {error ? (
        <p role="alert" className={ALERT_CLASS}>
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground ring-ring rounded-md px-5 py-2.5 font-medium outline-none focus-visible:ring-2 disabled:opacity-60"
      >
        {pending ? "Setting password..." : "Set password"}
      </button>
    </form>
  );
}
