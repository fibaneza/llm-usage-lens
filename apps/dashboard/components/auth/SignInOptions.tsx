"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { TEAM_LEAD_OID } from "@/lib/auth/team-lead-identity";
import { GLOBAL_ROLES, INTERNAL_ADMIN_ROLE } from "@/lib/auth/roles";

// Not a role: the "Team lead" choice posts the seeded lead identity instead
// (Access Control - Dev sign-in as a lead, D14); the store supplies the scope.
const TEAM_LEAD_OPTION = "team-lead";

type DevLoginState = { ok: false } | null;
type FormAction = (formData: FormData) => Promise<{ ok: false } | void>;

type SignInOptionsProps = {
  entra: boolean;
  devLogin: boolean;
  master?: boolean;
  entraAction: () => Promise<void>;
  devLoginAction: (
    previous: DevLoginState,
    formData: FormData,
  ) => Promise<DevLoginState>;
  masterAction?: FormAction;
  password?: boolean;
  passwordAction?: FormAction;
};

const GENERIC_FAILURE =
  "Those details are not right. Check them and try again.";
const CODE_HINT =
  "6-digit code from your authenticator app. Leave empty if you have not set one up.";

const BUTTON_CLASS =
  "bg-primary text-primary-foreground ring-ring rounded-md px-5 py-2.5 font-medium outline-none focus-visible:ring-2";
const FIELD_CLASS =
  "border-border bg-background text-foreground ring-ring min-h-(--spacing-touch) rounded-md border px-3 py-2 outline-none focus-visible:ring-2 md:min-h-(--spacing-control)";
const GROUP_CLASS =
  "border-border bg-card flex w-full max-w-sm flex-col gap-3 rounded-md border p-4 text-left";

// Design System - Sign-in page, The forms (T-SI4): one generic state; focus
// returns to the group's first field. A fresh object per refusal re-triggers it.
function useRefusal(action: FormAction) {
  const [state, run] = useActionState(
    async (_previous: { ok: false } | null, formData: FormData) => {
      const result = await action(formData);
      return result ? { ok: false as const } : null;
    },
    null,
  );
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state) first.current?.focus();
  }, [state]);
  return { state, run, first };
}

function Group({
  title,
  headingId,
  children,
}: {
  title: string;
  headingId: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={headingId} className={GROUP_CLASS}>
      <h2 id={headingId} className="text-foreground text-sm font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Failure({ shown, id }: { shown: boolean; id: string }) {
  return shown ? (
    <p id={id} role="alert" className="text-destructive text-sm">
      {GENERIC_FAILURE}
    </p>
  ) : null;
}

function CodeField({
  id,
  hintId,
  failureId,
}: {
  id: string;
  hintId: string;
  failureId?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-foreground text-sm">
        Authenticator code
      </label>
      <input
        id={id}
        name="totp"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-describedby={failureId ? `${hintId} ${failureId}` : hintId}
        aria-invalid={failureId ? true : undefined}
        className={FIELD_CLASS}
      />
      <p id={hintId} className="text-muted-foreground text-xs">
        {CODE_HINT}
      </p>
    </div>
  );
}

function PasswordGroup({ action }: { action: FormAction }) {
  const { state, run, first } = useRefusal(action);
  const [shown, setShown] = useState(false);
  const base = useId();
  const failureId = state ? `${base}-failure` : undefined;
  return (
    <Group title="Email and password" headingId={`${base}-h`}>
      <form action={run} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${base}-email`} className="text-foreground text-sm">
            Email
          </label>
          <input
            ref={first}
            id={`${base}-email`}
            name="email"
            type="email"
            autoComplete="username"
            required
            aria-describedby={failureId}
            aria-invalid={failureId ? true : undefined}
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${base}-password`}
            className="text-foreground text-sm"
          >
            Password
          </label>
          <div className="relative">
            <input
              id={`${base}-password`}
              name="password"
              type={shown ? "text" : "password"}
              autoComplete="current-password"
              required
              aria-describedby={failureId}
              aria-invalid={failureId ? true : undefined}
              className={`${FIELD_CLASS} w-full pr-11`}
            />
            <button
              type="button"
              aria-label={shown ? "Hide password" : "Show password"}
              aria-pressed={shown}
              onClick={() => setShown((value) => !value)}
              className="text-muted-foreground ring-ring absolute inset-y-0 right-0 flex min-w-(--spacing-touch) items-center justify-center rounded-md outline-none focus-visible:ring-2 md:min-w-(--spacing-control)"
            >
              {shown ? (
                <EyeOff aria-hidden="true" className="size-4" />
              ) : (
                <Eye aria-hidden="true" className="size-4" />
              )}
            </button>
          </div>
        </div>
        <CodeField
          id={`${base}-totp`}
          hintId={`${base}-hint`}
          failureId={failureId}
        />
        <Failure shown={state !== null} id={`${base}-failure`} />
        <button type="submit" className={BUTTON_CLASS}>
          Sign in
        </button>
      </form>
    </Group>
  );
}

function MasterGroup({ action }: { action: FormAction }) {
  const { state, run, first } = useRefusal(action);
  const [open, setOpen] = useState(false);
  const base = useId();
  const failureId = state ? `${base}-failure` : undefined;
  return (
    <Group title="Master user" headingId={`${base}-h`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${base}-form`}
        onClick={() => setOpen((value) => !value)}
        className="text-foreground ring-ring border-border rounded-md border px-5 py-2.5 font-medium outline-none focus-visible:ring-2"
      >
        Sign in as master user
      </button>
      {open ? (
        <form id={`${base}-form`} action={run} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${base}-username`}
              className="text-foreground text-sm"
            >
              Username
            </label>
            <input
              ref={first}
              id={`${base}-username`}
              name="username"
              autoComplete="username"
              required
              aria-describedby={failureId}
              aria-invalid={failureId ? true : undefined}
              className={FIELD_CLASS}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${base}-password`}
              className="text-foreground text-sm"
            >
              Password
            </label>
            <input
              id={`${base}-password`}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-describedby={failureId}
              aria-invalid={failureId ? true : undefined}
              className={FIELD_CLASS}
            />
          </div>
          <CodeField
            id={`${base}-totp`}
            hintId={`${base}-hint`}
            failureId={failureId}
          />
          <Failure shown={state !== null} id={`${base}-failure`} />
          <button type="submit" className={BUTTON_CLASS}>
            Sign in
          </button>
        </form>
      ) : null}
    </Group>
  );
}

export function SignInOptions({
  entra,
  devLogin,
  master = false,
  entraAction,
  devLoginAction,
  masterAction,
  password = false,
  passwordAction,
}: SignInOptionsProps) {
  const [devState, devAction] = useActionState(devLoginAction, null);
  const [identity, setIdentity] = useState("");
  const [choice, setChoice] = useState<string>(INTERNAL_ADMIN_ROLE);
  const asLead = choice === TEAM_LEAD_OPTION && identity.trim() === "";
  const base = useId();
  return (
    <div className="flex w-full flex-col items-center gap-4">
      {entra ? (
        <Group title="Microsoft" headingId={`${base}-entra`}>
          <form action={entraAction}>
            <button type="submit" className={BUTTON_CLASS}>
              Sign in with Microsoft
            </button>
          </form>
        </Group>
      ) : null}
      {password && passwordAction ? (
        <PasswordGroup action={passwordAction} />
      ) : null}
      {devLogin ? (
        <Group title="Local development" headingId={`${base}-dev`}>
          <form action={devAction} className="flex flex-col gap-3">
            <label className="text-foreground flex flex-col gap-1 text-left text-sm">
              Role
              <select
                name={asLead ? undefined : "role"}
                disabled={identity.trim() !== ""}
                aria-describedby={identity.trim() ? "dev-role-hint" : undefined}
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
                className={FIELD_CLASS}
              >
                {GLOBAL_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
                <option value={TEAM_LEAD_OPTION}>Team lead</option>
              </select>
            </label>
            {asLead ? (
              <input type="hidden" name="identity" value={TEAM_LEAD_OID} />
            ) : null}
            {identity.trim() ? (
              <p id="dev-role-hint" className="text-muted-foreground text-sm">
                The role comes from the stored user.
              </p>
            ) : null}
            <label className="text-foreground flex flex-col gap-1 text-left text-sm">
              Sign in as (email or user id)
              <input
                name="identity"
                disabled={asLead}
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
                : asLead
                  ? "Sign in as team lead"
                  : "Sign in as local developer"}
            </button>
          </form>
        </Group>
      ) : null}
      {master && masterAction ? <MasterGroup action={masterAction} /> : null}
    </div>
  );
}
