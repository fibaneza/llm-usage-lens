import "server-only";

import { createHash } from "node:crypto";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user links"
// (the one comparison function shared by the link route's `match` mode and
// the LiteLLM user sync; no second comparison, review change V6), "LiteLLM
// user sync" - *Match keys per sign-in mode* (SM3, SM4) and *Same person*;
// threat T2 (the `email` claim is not a bind key); tests T-SM1, T-SM2, T-SY1.
// Pure. `sso_user_id` is compared here and never returned or logged (S20).

export type MatchIdentity = {
  oid: string;
  authMethod: string;
  tid?: string | null;
  upn?: string | null;
  email?: string | null;
  // A password user's reserved `sso.expectedOid`.
  expectedOid?: string | null;
};

export type MatchLiteLLMUserInput = {
  userId: string;
  email: string | null;
  ssoUserId: string | null;
};

export type LiteLLMMatch = { entraId: boolean; email: boolean };

const LOCAL_PREFIX = "local:";

export const normalizeEmail = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase();

// The pending-link key of a non-email placeholder: a hash, so an SSO reference
// is never stored, logged or shown in clear (Access Control - LiteLLM user
// sync, S20, T-SY1; amended 2026-11-24).
export const SSO_KEY_PREFIX = "sso:";
export const ssoPendingKey = (reference: string): string =>
  `${SSO_KEY_PREFIX}${createHash("sha256")
    .update(reference.trim().toLowerCase())
    .digest("hex")}`;

const isGuestUpn = (upn: string): boolean => upn.includes("#ext#");

// The Entra id key of an identity: an Entra identity's `oid`, a password
// user's reserved expected oid, never a `local:` id (SM4).
export function entraIdOf(identity: MatchIdentity): string | null {
  const candidate =
    identity.authMethod === "entra"
      ? identity.oid
      : identity.authMethod === "password"
        ? identity.expectedOid
        : null;
  if (!candidate || candidate.startsWith(LOCAL_PREFIX)) return null;
  return candidate.toLowerCase();
}

// The email key of an identity (SM3): an Entra identity's tenant-checked,
// non-guest UPN; a password user's sign-in email.
export function emailKeyOf(
  identity: MatchIdentity,
  tenant: string | null,
): string | null {
  if (identity.authMethod === "password") {
    return normalizeEmail(identity.email) || null;
  }
  if (identity.authMethod !== "entra") return null;
  if (!tenant || identity.tid?.toLowerCase() !== tenant.toLowerCase()) {
    return null;
  }
  const upn = normalizeEmail(identity.upn);
  return upn && !isGuestUpn(upn) ? upn : null;
}

export type MatchOptions = {
  // The `match` mode of the link route compares the identity's stored email
  // that an admin confirms in a dialog (T-MI1), not the sign-in keys. The
  // automatic paths never set it.
  storedEmail?: boolean;
};

export function matchLiteLLMUser(
  identity: MatchIdentity,
  litellmUser: MatchLiteLLMUserInput,
  tenant: string | null,
  options: MatchOptions = {},
): LiteLLMMatch {
  const key = options.storedEmail
    ? normalizeEmail(identity.email) || null
    : emailKeyOf(identity, tenant);
  const userEmail = normalizeEmail(litellmUser.email);
  const entraId = entraIdOf(identity);
  const ids = [litellmUser.userId, litellmUser.ssoUserId]
    .filter((id): id is string => Boolean(id) && !id?.startsWith(LOCAL_PREFIX))
    .map((id) => id.toLowerCase());
  return {
    entraId: entraId !== null && ids.includes(entraId),
    email: key !== null && userEmail !== "" && key === userEmail,
  };
}
