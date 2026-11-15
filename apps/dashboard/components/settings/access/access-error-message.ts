import { ApiRequestError } from "@/lib/query/fetch-api";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// error-code registry. Code-driven copy: no raw code reaches the sentence.
const MESSAGES: Record<string, string> = {
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "That item no longer exists.",
  CONFLICT:
    "This changed since you loaded it, or it clashes with an existing entry. Reload and try again.",
  MANAGED_BY_SSO: "This is managed in Entra. Change it there.",
  ALREADY_AFFILIATED:
    "This person already belongs to a team. Use Move to change their team.",
  SSO_BOUND:
    "This user signs in with single sign-on (Entra), so password actions don't apply.",
  WEAK_PASSWORD: "That password is too weak. Choose a longer one.",
  REAUTH_REQUIRED: "Confirm it's you with a recent sign-in, then try again.",
};

export function isReauthRequired(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "REAUTH_REQUIRED";
}

export function accessErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return MESSAGES[error.code] ?? error.message;
  }
  return "Request failed — try again";
}
