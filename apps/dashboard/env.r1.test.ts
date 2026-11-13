import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Source: docs/specs/2026-11-10-access-control.md — Environment; Threat model
// T7, T21. Contract R1 decision 8. env.ts validation (SKIP_ENV_VALIDATION off).
const ENTRA = {
  AUTH_MICROSOFT_ENTRA_ID_ID: "client-id",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "client-secret",
  AUTH_MICROSOFT_ENTRA_ID_ISSUER:
    "https://login.microsoftonline.com/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/v2.0",
};
const MASTER = {
  AUTH_MASTER_USERNAME: "root",
  AUTH_MASTER_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
};

function stubBase(overrides: Record<string, string>) {
  const vars: Record<string, string> = {
    SKIP_ENV_VALIDATION: "",
    AUTH_SECRET: "test-secret",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PHASE: "",
    NODE_ENV: "development",
    APP_ENV: "dev",
    AUTH_ACCESS_MODE: "",
    AUTH_DEV_LOGIN: "",
    AUTH_MICROSOFT_ENTRA_ID_ID: "",
    AUTH_MICROSOFT_ENTRA_ID_SECRET: "",
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: "",
    AUTH_MASTER_USERNAME: "",
    AUTH_MASTER_PASSWORD_HASH: "",
    AUTH_MASTER_TOTP_SECRET: "",
    ...overrides,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  vi.stubGlobal("window", undefined);
}
async function loadEnv() {
  vi.resetModules();
  return import("@/env");
}

describe("env.ts R1 rules", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts the dev baseline with the dev login", async () => {
    stubBase({ AUTH_DEV_LOGIN: "true" });
    const { env } = await loadEnv();
    expect(env.APP_ENV).toBe("dev");
  });

  it.each(["", "staging", "production"])("rejects APP_ENV=%j", async (v) => {
    stubBase({ APP_ENV: v, AUTH_DEV_LOGIN: "true" });
    await expect(loadEnv()).rejects.toThrow();
  });

  it("T7: rejects AUTH_DEV_LOGIN=true when Entra is configured", async () => {
    stubBase({ AUTH_DEV_LOGIN: "true", ...ENTRA });
    await expect(loadEnv()).rejects.toThrow();
  });

  it("T21: rejects AUTH_ACCESS_MODE=open with APP_ENV=prod", async () => {
    stubBase({
      NODE_ENV: "production",
      APP_ENV: "prod",
      AUTH_ACCESS_MODE: "open",
      ...ENTRA,
    });
    await expect(loadEnv()).rejects.toThrow();
  });

  it("an unset or invalid AUTH_ACCESS_MODE is not a validation error", async () => {
    for (const mode of ["", "bogus"]) {
      stubBase({ AUTH_DEV_LOGIN: "true", AUTH_ACCESS_MODE: mode });
      await expect(loadEnv()).resolves.toBeDefined();
    }
  });

  // Access Control spec — Pre-SSO mode (D19).
  it("T21: APP_ENV=prod without Entra needs the master user with TOTP", async () => {
    stubBase({
      NODE_ENV: "production",
      APP_ENV: "prod",
      ...MASTER,
      AUTH_MASTER_TOTP_SECRET: "JBSWY3DPEHPK3PXP",
    });
    await expect(loadEnv()).resolves.toBeDefined();
    vi.unstubAllEnvs();
    stubBase({ NODE_ENV: "production", APP_ENV: "prod" });
    await expect(loadEnv()).rejects.toThrow();
    vi.unstubAllEnvs();
    stubBase({ NODE_ENV: "production", APP_ENV: "prod", ...MASTER });
    await expect(loadEnv()).rejects.toThrow();
  });

  it("T21: APP_ENV=prod with the master user requires TOTP", async () => {
    stubBase({ NODE_ENV: "production", APP_ENV: "prod", ...ENTRA, ...MASTER });
    await expect(loadEnv()).rejects.toThrow();
    vi.unstubAllEnvs();
    stubBase({
      NODE_ENV: "production",
      APP_ENV: "prod",
      ...ENTRA,
      ...MASTER,
      AUTH_MASTER_TOTP_SECRET: "JBSWY3DPEHPK3PXP",
    });
    await expect(loadEnv()).resolves.toBeDefined();
  });

  it("NODE_ENV=production accepts the master user alone (APP_ENV=dev) and rejects no provider", async () => {
    stubBase({ NODE_ENV: "production", ...MASTER });
    await expect(loadEnv()).resolves.toBeDefined();
    vi.unstubAllEnvs();
    stubBase({ NODE_ENV: "production" });
    await expect(loadEnv()).rejects.toThrow();
  });

  it("rejects a half-configured master user and a non-argon2id hash", async () => {
    stubBase({ ...ENTRA, AUTH_MASTER_USERNAME: "root" });
    await expect(loadEnv()).rejects.toThrow();
    vi.unstubAllEnvs();
    stubBase({ ...ENTRA, ...MASTER, AUTH_MASTER_PASSWORD_HASH: "plain" });
    await expect(loadEnv()).rejects.toThrow();
  });
});
