import { randomBytes } from "node:crypto";

import { trace } from "@opentelemetry/api";
import { argon2Verify, argon2id } from "hash-wasm";

// Source: docs/specs/2026-11-10-access-control.md — "Password users"
// (Passwords: Argon2id at the master user's parameters; Sign-in: an unknown
// email runs the same work against a dummy hash, T23). Parameters per
// docs/guides/auth-setup.md.
const PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536,
  hashLength: 32,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    ...PARAMS,
    outputType: "encoded",
  });
}

let dummy: Promise<string> | undefined;
const dummyHash = (): Promise<string> =>
  (dummy ??= hashPassword(randomBytes(24).toString("base64url")));

export async function verifyPassword(
  password: string,
  hash: string | null,
): Promise<boolean> {
  const target = hash ?? (await dummyHash());
  try {
    const matched = await argon2Verify({ password, hash: target });
    return hash !== null && matched;
  } catch {
    trace
      .getActiveSpan()
      ?.recordException(new Error("argon2 verification threw"));
    return false;
  }
}
