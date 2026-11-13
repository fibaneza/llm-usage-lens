import { describe, expect, it } from "vitest";

import {
  AuthConfigError,
  resolveAccessMode,
  resolveSignInProviders,
  type AuthEnvInput,
} from "./auth-config";

// Source: docs/specs/2026-11-10-access-control.md — Environment; Sign-in
// methods; Threat model T7 (no dev login beside Entra) and T21 (APP_ENV
// required; open never in prod; prod needs Entra and TOTP for the master
// user). Contract R1 decisions 6-8. AuthEnvInput gains `appEnv`,
// `masterUsername`, `masterPasswordHash`, `masterTotpSecret`; the result gains
// `master: boolean`.
const ENTRA = {
  entraId: "client-id",
  entraSecret: "client-secret",
  entraIssuer:
    "https://login.microsoftonline.com/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/v2.0",
};
const MASTER = {
  masterUsername: "root",
  masterPasswordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
};

const resolve = (input: Partial<AuthEnvInput>) =>
  resolveSignInProviders({
    nodeEnv: "development",
    appEnv: "dev",
    ...input,
  } as AuthEnvInput);

describe("resolveAccessMode", () => {
  it("returns open and enforce as given in dev", () => {
    expect(resolveAccessMode("open", "dev")).toBe("open");
    expect(resolveAccessMode("enforce", "dev")).toBe("enforce");
  });
  it.each([undefined, "", "nope", "OPEN "])(
    "falls back to enforce for %j",
    (raw) => {
      expect(resolveAccessMode(raw, "dev")).toBe("enforce");
      expect(resolveAccessMode(raw, "prod")).toBe("enforce");
    },
  );
  it("rejects open in prod with a message that names the variable", () => {
    expect(() => resolveAccessMode("open", "prod")).toThrow(AuthConfigError);
    expect(() => resolveAccessMode("open", "prod")).toThrow(/AUTH_ACCESS_MODE/);
  });
});

describe("resolveSignInProviders (R1 rules)", () => {
  it("T7: rejects the dev login when Entra is configured", () => {
    expect(() => resolve({ ...ENTRA, devLogin: "true" })).toThrow(
      AuthConfigError,
    );
    expect(() => resolve({ ...ENTRA, devLogin: "true" })).toThrow(
      /AUTH_DEV_LOGIN/,
    );
  });

  it("T21: requires APP_ENV", () => {
    expect(() => resolve({ appEnv: undefined, devLogin: "true" })).toThrow(
      AuthConfigError,
    );
    expect(() =>
      resolve({ appEnv: "staging" as never, devLogin: "true" }),
    ).toThrow(AuthConfigError);
  });

  // Access Control spec — Pre-SSO mode (D19): prod without Entra is valid
  // only with the master user and TOTP.
  it("T21: APP_ENV=prod without Entra needs the master user with TOTP", () => {
    expect(
      resolve({
        appEnv: "prod",
        nodeEnv: "production",
        ...MASTER,
        masterTotpSecret: "JBSWY3DPEHPK3PXP",
      }),
    ).toMatchObject({ entra: false, master: true, devLogin: false });
    expect(() => resolve({ appEnv: "prod", nodeEnv: "production" })).toThrow(
      AuthConfigError,
    );
    expect(() =>
      resolve({ appEnv: "prod", nodeEnv: "production", ...MASTER }),
    ).toThrow(AuthConfigError);
  });

  it("T21: prod with the master user requires a TOTP secret", () => {
    expect(() =>
      resolve({ appEnv: "prod", nodeEnv: "production", ...ENTRA, ...MASTER }),
    ).toThrow(/AUTH_MASTER_TOTP_SECRET/);
    expect(
      resolve({
        appEnv: "prod",
        nodeEnv: "production",
        ...ENTRA,
        ...MASTER,
        masterTotpSecret: "JBSWY3DPEHPK3PXP",
      }),
    ).toMatchObject({ entra: true, master: true, devLogin: false });
  });

  it("master username and hash must be set together", () => {
    expect(() => resolve({ ...ENTRA, masterUsername: "root" })).toThrow(
      AuthConfigError,
    );
    expect(() =>
      resolve({ ...ENTRA, masterPasswordHash: MASTER.masterPasswordHash }),
    ).toThrow(AuthConfigError);
  });

  it("rejects a master hash that is not argon2id", () => {
    expect(() =>
      resolve({ ...ENTRA, ...MASTER, masterPasswordHash: "plaintext" }),
    ).toThrow(AuthConfigError);
  });

  it("master provider is off when unset, on when configured", () => {
    expect(resolve({ ...ENTRA })).toMatchObject({ master: false });
    expect(resolve({ ...ENTRA, ...MASTER })).toMatchObject({ master: true });
  });

  it("NODE_ENV=production accepts the master user alone as the production provider", () => {
    expect(
      resolve({ nodeEnv: "production", appEnv: "dev", ...MASTER }),
    ).toMatchObject({ entra: false, master: true, devLogin: false });
  });

  it("NODE_ENV=production with neither Entra nor the master user throws", () => {
    expect(() => resolve({ nodeEnv: "production", appEnv: "dev" })).toThrow(
      AuthConfigError,
    );
  });

  it("NODE_ENV=production still rejects AUTH_DEV_LOGIN", () => {
    expect(() =>
      resolve({ nodeEnv: "production", devLogin: "true", ...MASTER }),
    ).toThrow(/AUTH_DEV_LOGIN/);
  });

  it("dev login alone works in dev; error messages never contain values", () => {
    expect(resolve({ devLogin: "true" })).toMatchObject({
      devLogin: true,
      entra: false,
    });
    try {
      resolve({ appEnv: "prod", nodeEnv: "production", ...ENTRA, ...MASTER });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(MASTER.masterPasswordHash);
      expect(msg).not.toContain(ENTRA.entraSecret);
    }
  });
});
