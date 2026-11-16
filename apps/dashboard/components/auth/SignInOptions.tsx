"use client";

import { useActionState, useState } from "react";

import { GLOBAL_ROLES, INTERNAL_ADMIN_ROLE } from "@/lib/auth/roles";

type DevLoginState = { ok: false } | null;

type SignInOptionsProps = {
  entra: boolean;
  devLogin: boolean;
  master?: boolean;
  entraAction: () => Promise<void>;
  devLoginAction: (
    previous: DevLoginState,
    formData: FormData,
  ) => Promise<DevLoginState>;
  masterAction?: (formData: FormData) => Promise<void>;
};

const BUTTON_CLASS =
  "bg-primary text-primary-foreground ring-ring rounded-md px-5 py-2.5 font-medium outline-none focus-visible:ring-2";
const FIELD_CLASS =
  "border-border bg-background text-foreground ring-ring rounded-md border px-3 py-2 outline-none focus-visible:ring-2";

export function SignInOptions({
  entra,
  devLogin,
  master = false,
  entraAction,
  devLoginAction,
  masterAction,
}: SignInOptionsProps) {
  const [devState, devAction] = useActionState(devLoginAction, null);
  const [identity, setIdentity] = useState("");
  return (
    <div className="flex flex-col items-center gap-4">
      {entra ? (
        <form action={entraAction}>
          <button type="submit" className={BUTTON_CLASS}>
            Sign in with Microsoft
          </button>
        </form>
      ) : null}
      {devLogin ? (
        <form action={devAction} className="flex flex-col gap-3">
          <label className="text-foreground flex flex-col gap-1 text-left text-sm">
            Role
            <select
              name="role"
              defaultValue={INTERNAL_ADMIN_ROLE}
              className={FIELD_CLASS}
            >
              {GLOBAL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label className="text-foreground flex flex-col gap-1 text-left text-sm">
            Sign in as (email or user id)
            <input
              name="identity"
              autoComplete="off"
              className={FIELD_CLASS}
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
            />
          </label>
          {devState?.ok === false ? (
            <p role="alert" className="text-destructive text-sm">
              That identity could not be used to sign in.
            </p>
          ) : null}
          <button type="submit" className={BUTTON_CLASS}>
            {identity.trim()
              ? `Sign in as ${identity.trim()}`
              : "Sign in as local developer"}
          </button>
        </form>
      ) : null}
      {master && masterAction ? (
        <form action={masterAction} className="flex flex-col gap-3">
          <input
            name="username"
            autoComplete="username"
            aria-label="Username"
            required
            className={FIELD_CLASS}
          />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            aria-label="Password"
            required
            className={FIELD_CLASS}
          />
          <input
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Authenticator code"
            className={FIELD_CLASS}
          />
          <button type="submit" className={BUTTON_CLASS}>
            Sign in as master user
          </button>
        </form>
      ) : null}
    </div>
  );
}
