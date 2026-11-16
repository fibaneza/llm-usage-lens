import { DEV_LOGIN_PROVIDER_ID } from "@/lib/auth/auth-config";
import { REAUTH_MAX_AGE_SECONDS } from "@/lib/auth/recent-auth";
import { isGlobalRole } from "@/lib/auth/roles";

// Source: docs/specs/2026-11-10-access-control.md - "Recent authentication",
// Step-up (T32): a step-up is a full sign-in through the existing providers.
// The identifier comes from the session, never from the form.
// D33: the step-up returns to the section that asked for it.
export const STEP_UP_REDIRECTS = {
  "role-grants": "/dashboard/settings/access/roles#role-grants",
  "password-users": "/dashboard/settings/access/sign-in#password-users",
} as const;

export type StepUpSection = keyof typeof STEP_UP_REDIRECTS;

function redirectFor(section: string): string | null {
  return Object.hasOwn(STEP_UP_REDIRECTS, section)
    ? STEP_UP_REDIRECTS[section as StepUpSection]
    : null;
}

type StepUpSession =
  | {
      user?: {
        authMethod?: unknown;
        email?: unknown;
        roles?: unknown;
      } | null;
    }
  | null
  | undefined;

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export function buildEntraStepUp(section: string, session: StepUpSession) {
  const redirectTo = redirectFor(section);
  if (redirectTo === null) return null;
  if (session?.user?.authMethod !== "entra") {
    return null;
  }
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

// A dev-login session confirms by choosing the dev login again, as its own
// role; the role comes from the session, never from the client (B3, T32).
export function buildDevLoginStepUp(session: StepUpSession, section: string) {
  const redirectTo = redirectFor(section);
  if (redirectTo === null) return null;
  const user = session?.user;
  if (user?.authMethod !== "local") return null;
  const role = Array.isArray(user.roles)
    ? (user.roles as unknown[]).find(isGlobalRole)
    : undefined;
  if (role === undefined) return null;
  return {
    providerId: DEV_LOGIN_PROVIDER_ID,
    redirectTo,
    role,
  } as const;
}
