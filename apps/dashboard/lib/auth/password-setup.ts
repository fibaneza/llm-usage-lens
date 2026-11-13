import { randomUUID } from "node:crypto";

import {
  completePasswordSetupWrite,
  findSetupLink,
} from "@/lib/data/access/password-credentials-store";
import { getPasswordSignIn, sha256Hex } from "@/lib/data/access/password-users";

import { encryptSecret } from "./secret-envelope";
import { hashPassword } from "./password-hash";
import { checkPassword } from "./password-policy";
import { findTotpStep } from "./totp";
import { isTotpRequired } from "./totp-user";

// Source: docs/specs/2026-11-10-access-control.md — "Password users" (Setup
// D22, Passwords, TOTP D23), threats T24, T27. An unknown, used or expired
// token gives one generic error; a failed attempt does not consume the token.
export type PasswordSetupInput = {
  token: string;
  password: string;
  totp?: { secret: string; code: string };
};

export type PasswordSetupResult =
  | {
      ok: true;
      identity: {
        oid: string;
        tid: "local";
        email: string;
        displayName: string;
        authMethod: "password";
      };
    }
  | {
      ok: false;
      code: "INVALID_LINK" | "WEAK_PASSWORD" | "TOTP_REQUIRED" | "TOTP_INVALID";
    };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SECRET_PATTERN = /^[A-Z2-7]{16,64}$/;
const INVALID_LINK = { ok: false, code: "INVALID_LINK" } as const;

export async function completePasswordSetup(
  input: PasswordSetupInput,
  deps: { now?: () => Date } = {},
): Promise<PasswordSetupResult> {
  const now = (deps.now ?? (() => new Date()))();
  if (!TOKEN_PATTERN.test(input.token)) return INVALID_LINK;
  const tokenHash = sha256Hex(input.token);
  const link = await findSetupLink(tokenHash);
  if (
    !link ||
    link.status !== "enabled" ||
    Date.parse(link.expiresAt) <= now.getTime()
  ) {
    return INVALID_LINK;
  }

  if (!(await getPasswordSignIn()).enabled) return INVALID_LINK;

  if (checkPassword(input.password) !== "ok") {
    return { ok: false, code: "WEAK_PASSWORD" };
  }

  let totp: { cipher: string; step: number } | undefined;
  if (input.totp) {
    const step = SECRET_PATTERN.test(input.totp.secret)
      ? findTotpStep(input.totp.secret, input.totp.code, now)
      : null;
    if (step === null) return { ok: false, code: "TOTP_INVALID" };
    totp = { cipher: await encryptSecret(input.totp.secret), step };
  } else if (await isTotpRequired(link.oid)) {
    return { ok: false, code: "TOTP_REQUIRED" };
  }

  const written = await completePasswordSetupWrite(
    {
      email: link.email,
      tokenHash,
      passwordHash: await hashPassword(input.password),
      ...(totp ? { totp } : {}),
    },
    {
      actor: link.oid,
      requestId: randomUUID(),
      now,
      sequence: { next: 0 },
    },
  );
  if (!written.ok) return INVALID_LINK;
  return {
    ok: true,
    identity: {
      oid: link.oid,
      tid: "local",
      email: link.email,
      displayName: link.displayName,
      authMethod: "password",
    },
  };
}
