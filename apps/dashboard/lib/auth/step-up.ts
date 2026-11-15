import { REAUTH_MAX_AGE_SECONDS } from "@/lib/auth/recent-auth";

// Source: docs/specs/2026-11-10-access-control.md - "Recent authentication",
// Step-up (T32): a step-up is a full sign-in through the existing providers.
// The identifier comes from the session, never from the form.
// D33: the step-up returns to the section that asked for it.
export const STEP_UP_REDIRECTS = {
  "role-grants": "/dashboard/settings#role-grants",
  "password-users": "/dashboard/settings#password-users",
} as const;

export type StepUpSection = keyof typeof STEP_UP_REDIRECTS;

function redirectFor(section: string): string | null {
  return Object.hasOwn(STEP_UP_REDIRECTS, section)
    ? STEP_UP_REDIRECTS[section as StepUpSection]
    : null;
}

type StepUpSession =
  | { user?: { authMethod?: unknown; email?: unknown } | null }
  | null
  | undefined;

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export function buildEntraStepUp(section: string) {
  const redirectTo = redirectFor(section);
  if (redirectTo === null) return null;
  return {
    providerId: "microsoft-entra-id",
    redirectTo,
    authorizationParams: {
      prompt: "login",
      max_age: String(REAUTH_MAX_AGE_SECONDS),
    },
  } as const;
}

export function buildPasswordStepUp(
  session: StepUpSession,
  form: FormData,
  section: string,
) {
  const redirectTo = redirectFor(section);
  if (redirectTo === null) return null;
  const user = session?.user;
  if (user?.authMethod !== "password") return null;
  if (typeof user.email !== "string" || user.email === "") return null;
  return {
    providerId: "password",
    redirectTo,
    credentials: {
      email: user.email,
      password: formString(form, "password"),
      totp: formString(form, "totp"),
    },
  } as const;
}

export function buildMasterStepUp(
  session: StepUpSession,
  form: FormData,
  masterUsername: string | undefined,
  section: string,
) {
  const redirectTo = redirectFor(section);
  if (redirectTo === null) return null;
  if (session?.user?.authMethod !== "master") return null;
  if (!masterUsername) return null;
  return {
    providerId: "master-user",
    redirectTo,
    credentials: {
      username: masterUsername,
      password: formString(form, "password"),
      totp: formString(form, "totp"),
    },
  } as const;
}
