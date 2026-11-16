import { createHash, timingSafeEqual } from "node:crypto";

import { trace } from "@opentelemetry/api";
import { argon2Verify } from "hash-wasm";
import { z } from "zod";

import { MASTER_OID_PREFIX } from "@/lib/auth/master-oid";
import { verifyTotp } from "@/lib/auth/totp";
import { recordSecurityEvent } from "@/lib/auth/security-events";
import type { SecurityEvent } from "@/lib/auth/security-events";

// Source: docs/specs/2026-11-10-access-control.md — "Sign-in methods" (master
// user), "Threat model" T1, T20. Every failure is a generic null; one security
// event per attempt, id-only (Rule 50.6).

export { MASTER_OID_PREFIX };
export const MASTER_USER_PROVIDER_ID = "master-user";

export type MasterUserConfig = {
  username: string;
  passwordHash: string;
  totpSecret?: string;
};

export type SignedInIdentity = {
  oid: string;
  tid: string;
  email?: string;
  upn?: string;
  displayName?: string;
  roles: string[];
  authMethod: "entra" | "master" | "local";
};

export type MasterUserDeps = {
  now: () => Date;
  lockout: {
    reserve: (
      oid: string,
      now: Date,
    ) => Promise<{ allowed: boolean; lockedNow: boolean }>;
    reset: (oid: string) => Promise<void>;
  };
  recordEvent: (event: SecurityEvent) => Promise<void>;
};

const CredentialsSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
  totp: z.string().max(16).optional(),
});

const digest = (s: string) => createHash("sha256").update(s).digest();

async function defaultDeps(): Promise<MasterUserDeps> {
  const data = await import("@/lib/data/identity");
  return {
    now: () => new Date(),
    lockout: {
      reserve: data.reserveMasterAttempt,
      reset: data.resetMasterFailures,
    },
    recordEvent: recordSecurityEvent,
  };
}

export async function authorizeMasterUser(
  credentials: unknown,
  config: MasterUserConfig,
  deps?: Partial<MasterUserDeps>,
): Promise<SignedInIdentity | null> {
  const d: MasterUserDeps =
    deps?.now && deps.lockout && deps.recordEvent
      ? { now: deps.now, lockout: deps.lockout, recordEvent: deps.recordEvent }
      : { ...(await defaultDeps()), ...deps };
  const oid = `${MASTER_OID_PREFIX}${config.username.toLowerCase()}`;
  const emit = (action: SecurityEvent["action"]): Promise<void> =>
    d.recordEvent({
      action,
      result: action === "auth.master.signin" ? "success" : "failed",
      oid,
      at: d.now().toISOString(),
    });
  // A failure record that cannot be stored never changes the generic null.
  const emitFailure = async (
    action: SecurityEvent["action"],
  ): Promise<void> => {
    try {
      await emit(action);
    } catch (error) {
      trace
        .getActiveSpan()
        ?.recordException(
          error instanceof Error ? error : new Error("security event failed"),
        );
    }
  };

  const parsed = CredentialsSchema.safeParse(credentials);
  if (!parsed.success) {
    await emitFailure("auth.master.failure");
    return null;
  }
  const { username, password, totp } = parsed.data;

  const reservation = await d.lockout.reserve(oid, d.now());
  if (!reservation.allowed) {
    await emitFailure("auth.master.lockout");
    return null;
  }

  const userOk = timingSafeEqual(
    digest(username.toLowerCase()),
    digest(config.username.toLowerCase()),
  );
  let passwordOk = false;
  try {
    passwordOk = await argon2Verify({
      password,
      hash: config.passwordHash,
    });
  } catch (error) {
    trace
      .getActiveSpan()
      ?.recordException(
        new Error(
          error instanceof Error
            ? "argon2 verification threw"
            : "argon2 verification threw a non-error",
        ),
      );
    passwordOk = false;
  }
  const totpOk = config.totpSecret
    ? verifyTotp(config.totpSecret, totp ?? "", d.now())
    : true;

  if (!(userOk && passwordOk && totpOk)) {
    await emitFailure(
      reservation.lockedNow ? "auth.master.lockout" : "auth.master.failure",
    );
    return null;
  }

  await d.lockout.reset(oid);
  try {
    await emit("auth.master.signin");
  } catch (error) {
    trace
      .getActiveSpan()
      ?.recordException(
        error instanceof Error ? error : new Error("security event failed"),
      );
    return null;
  }
  return {
    oid,
    tid: "master",
    roles: ["internal-admin"],
    authMethod: "master",
  };
}
