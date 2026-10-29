import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t3-env only validates server vars when `window` is undefined, hence the node
// environment. Rules: docs/guides/auth-setup.md; Rule 50.2.
const ENTRA = {
  AUTH_MICROSOFT_ENTRA_ID_ID: "client-id",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "client-secret",
  AUTH_MICROSOFT_ENTRA_ID_ISSUER:
    "https://login.microsoftonline.com/tenant/v2.0",
};

function stubBase(overrides: Record<string, string>) {
  const vars: Record<string, string> = {
    SKIP_ENV_VALIDATION: "",
    AUTH_SECRET: "test-secret",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PHASE: "",
    AUTH_DEV_LOGIN: "",
    AUTH_MICROSOFT_ENTRA_ID_ID: "",
    AUTH_MICROSOFT_ENTRA_ID_SECRET: "",
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: "",
    ...overrides,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  // t3-env treats a defined `window` as the browser and skips server vars;
  // the unit project runs under jsdom, so hide it to load env.ts as on the server.
  vi.stubGlobal("window", undefined);
}

async function loadEnv() {
  vi.resetModules();
  return import("@/env");
}

describe("env.ts sign-in provider cross-check", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("throws in production with Entra and AUTH_DEV_LOGIN=true", async () => {
    stubBase({ NODE_ENV: "production", AUTH_DEV_LOGIN: "true", ...ENTRA });
    await expect(loadEnv()).rejects.toThrow();
  });

  it("throws in production without Entra", async () => {
    stubBase({ NODE_ENV: "production" });
    await expect(loadEnv()).rejects.toThrow();
  });

  it("throws in development with no provider", async () => {
    stubBase({ NODE_ENV: "development" });
    await expect(loadEnv()).rejects.toThrow();
  });

  it("throws with partial Entra configuration", async () => {
    stubBase({
      NODE_ENV: "development",
      AUTH_MICROSOFT_ENTRA_ID_ID: "client-id",
    });
    await expect(loadEnv()).rejects.toThrow();
  });

  it("passes in development with AUTH_DEV_LOGIN=true", async () => {
    stubBase({ NODE_ENV: "development", AUTH_DEV_LOGIN: "true" });
    const { env } = await loadEnv();
    expect(env.AUTH_DEV_LOGIN).toBe("true");
  });

  it("passes in production with full Entra", async () => {
    stubBase({ NODE_ENV: "production", ...ENTRA });
    const { env } = await loadEnv();
    expect(env.AUTH_MICROSOFT_ENTRA_ID_ID).toBe("client-id");
  });
});
