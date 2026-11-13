import { z } from "zod";

import {
  claimTotpStep,
  getPasswordCredential,
  reservePasswordAttempt,
  resetPasswordFailures,
} from "@/lib/data/access/password-credentials-store";
import { getPasswordSignIn } from "@/lib/data/access/password-users";

import { decryptSecret } from "./secret-envelope";
import { verifyPassword } from "./password-hash";
import { findTotpStep } from "./totp";
import { isTotpRequired } from "./totp-user";

// Source: docs/specs/2026-11-10-access-control.md — "Password users" (Sign-in,
// TOTP D23, Alongside Entra D24), threats T7, T23, T27, T28. Every refusal is
// the same generic null; an unknown or unusable user runs the same Argon2id
// work against a dummy hash. Lockout is per user and persisted (5 -> 15 min).
export type PasswordIdentity = {
  oid: string;
  tid: "local";
  email: string;
  displayName: string;
  authMethod: "password";
};

const CredentialsSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(256),
  totp: z.string().max(16).optional(),
});

export async function authorizePasswordUser(
  credentials: unknown,
  deps: { now?: () => Date } = {},
): Promise<PasswordIdentity | null> {
  const parsed = CredentialsSchema.safeParse(credentials);
  if (!parsed.success) return null;
  const { password, totp } = parsed.data;
  const email = parsed.data.email.toLowerCase();
  const now = (deps.now ?? (() => new Date()))();

  const [switchState, credential] = await Promise.all([
    getPasswordSignIn(),
    getPasswordCredential(email),
  ]);
  const usable =
    switchState.enabled &&
    credential !== null &&
    credential.status === "enabled" &&
    credential.passwordHash !== undefined
      ? credential
      : null;
  if (!usable) {
    await verifyPassword(password, null);
    return null;
  }

  const reservation = await reservePasswordAttempt(email, now);
  if (!reservation.allowed) {
    await verifyPassword(password, null);
    return null;
  }

  if (!(await verifyPassword(password, usable.passwordHash ?? null))) {
    return null;
  }

  if (usable.totpCipher) {
    const step = findTotpStep(
      await decryptSecret(usable.totpCipher),
      totp ?? "",
      now,
    );
    if (step === null) return null;
    if (usable.totpLastStep !== undefined && step <= usable.totpLastStep) {
      return null;
    }
    if (!(await claimTotpStep(email, step))) return null;
  } else if (await isTotpRequired(usable.oid)) {
    return null;
  }

  await resetPasswordFailures(email);
  return {
    oid: usable.oid,
    tid: "local",
    email: usable.email,
    displayName: usable.displayName,
    authMethod: "password",
  };
}
