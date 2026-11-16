import { describe, expect, it } from "vitest";

import {
  AuthConfigError,
  resolveSignInProviders,
} from "@/lib/auth/auth-config";

// Source: docs/specs/2026-11-10-access-control.md — "Pre-SSO mode" (D19): prod
// may run without Entra only when the master user is configured with TOTP.
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA";
const base = {
  nodeEnv: "production",
  appEnv: "prod",
  masterUsername: "breakglass",
  masterPasswordHash: HASH,
};

describe("resolveSignInProviders: Pre-SSO prod", () => {
  it("still rejects a partially configured Entra in prod", () => {
    expect(() =>
      resolveSignInProviders({
        ...base,
        masterTotpSecret: "totp-secret",
        entraId: "client-id",
      }),
    ).toThrow(AuthConfigError);
  });

  it("still rejects dev login in prod", () => {
    expect(() =>
      resolveSignInProviders({
        ...base,
        masterTotpSecret: "totp-secret",
        devLogin: "true",
      }),
    ).toThrow(AuthConfigError);
  });
});
