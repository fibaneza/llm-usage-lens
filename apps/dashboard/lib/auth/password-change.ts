import {
  changePasswordWrite,
  claimTotpStep,
  getPasswordCredential,
  reservePasswordAttempt,
} from "@/lib/data/access/password-credentials-store";
import type { AuditContext } from "@/lib/data/access/result";
import { getPasswordSignIn } from "@/lib/data/access/password-users";

import { decryptSecret } from "./secret-envelope";
import { hashPassword, verifyPassword } from "./password-hash";
import { checkPassword } from "./password-policy";
import { findTotpStep } from "./totp";
import { isTotpRequired } from "./totp-user";

// Source: docs/specs/2026-11-10-access-control.md - "Password users"
// (Passwords, Sign-in lockout shared with sign-in, TOTP D23, SSO binding),
// threats T23, T27. A weak new password is refused before any credential is
// checked, so it neither counts as a failed attempt nor spends a TOTP step.
// Every credential failure is the same DENIED.
export type PasswordChangeResult =
  | { ok: true }
  | { ok: false; code: "WEAK_PASSWORD" | "SSO_BOUND" | "DENIED" };

const DENIED = { ok: false, code: "DENIED" } as const;

export async function changeOwnPassword(
  input: {
    oid: string;
    email: string;
    currentPassword: string;
    newPassword: string;
    totp?: string;
    signedInAt?: number;
  },
  ctx: AuditContext,
): Promise<PasswordChangeResult> {
  if (checkPassword(input.newPassword) !== "ok") {
    return { ok: false, code: "WEAK_PASSWORD" };
  }
  const email = input.email.toLowerCase();
  const now = ctx.now;

  const [switchState, credential] = await Promise.all([
    getPasswordSignIn(),
    getPasswordCredential(email),
  ]);
  if (credential?.oid === input.oid && credential.status === "sso-bound") {
    return { ok: false, code: "SSO_BOUND" };
  }
  const usable =
    switchState.enabled &&
    credential !== null &&
    credential.oid === input.oid &&
    credential.status === "enabled" &&
    credential.passwordHash !== undefined
      ? credential
      : null;
  if (!usable) {
    await verifyPassword(input.currentPassword, null);
    return DENIED;
  }

  if (!(await reservePasswordAttempt(email, now)).allowed) {
    await verifyPassword(input.currentPassword, null);
    return DENIED;
  }
  if (
    !(await verifyPassword(input.currentPassword, usable.passwordHash ?? null))
  ) {
    return DENIED;
  }

  if (usable.totpCipher) {
    const step = findTotpStep(
      await decryptSecret(usable.totpCipher),
      input.totp ?? "",
      now,
    );
    if (step === null) return DENIED;
    if (usable.totpLastStep !== undefined && step <= usable.totpLastStep) {
      return DENIED;
    }
    if (!(await claimTotpStep(email, step))) return DENIED;
  } else if (await isTotpRequired(usable.oid)) {
    return DENIED;
  }

  const written = await changePasswordWrite(
    {
      email,
      passwordHash: await hashPassword(input.newPassword),
      ...(input.signedInAt !== undefined
        ? { signedInAt: input.signedInAt }
        : {}),
    },
    ctx,
  );
  return written.ok ? { ok: true } : DENIED;
}
