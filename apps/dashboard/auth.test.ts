import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Auth.js is mocked: these tests cover the wiring of the sign-in provider
// check in auth.ts, not Auth.js itself. Rule 50.3; docs/guides/auth-setup.md.
vi.mock("next-auth", () => ({
  default: () => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: unknown) => ({ type: "credentials", options }),
}));
vi.mock("next-auth/providers/microsoft-entra-id", () => ({
  default: { type: "oidc", id: "microsoft-entra-id" },
}));

const ENTRA = {
  AUTH_MICROSOFT_ENTRA_ID_ID: "client-id",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "client-secret",
  AUTH_MICROSOFT_ENTRA_ID_ISSUER:
    "https://login.microsoftonline.com/tenant/v2.0",
};

function stubBase(overrides: Record<string, string>) {
  const vars: Record<string, string> = {
    SKIP_ENV_VALIDATION: "1",
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

// resetModules gives each load a fresh AuthConfigError class, so fetch it from
// the same module graph as auth.ts for the instanceof check.
async function expectAuthConfigError() {
  vi.resetModules();
  const { AuthConfigError } = await import("@/lib/auth/auth-config");
  await expect(import("@/auth")).rejects.toBeInstanceOf(AuthConfigError);
}

async function loadAuth() {
  vi.resetModules();
  return import("@/auth");
}

describe("auth.ts runtime sign-in provider check", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("throws AuthConfigError for production + AUTH_DEV_LOGIN=true even with SKIP_ENV_VALIDATION", async () => {
    stubBase({ NODE_ENV: "production", AUTH_DEV_LOGIN: "true", ...ENTRA });
    await expectAuthConfigError();
  });

  it("throws AuthConfigError for production without Entra even with SKIP_ENV_VALIDATION", async () => {
    stubBase({ NODE_ENV: "production" });
    await expectAuthConfigError();
  });

  it("skips the check during the production build and never enables dev login", async () => {
    stubBase({
      NODE_ENV: "production",
      NEXT_PHASE: "phase-production-build",
      AUTH_DEV_LOGIN: "true",
    });
    const mod = await loadAuth();
    expect(mod.enabledSignInProviders.devLogin).toBe(false);
  });

  it("enables dev login in development", async () => {
    stubBase({ NODE_ENV: "development", AUTH_DEV_LOGIN: "true" });
    const mod = await loadAuth();
    expect(mod.enabledSignInProviders.devLogin).toBe(true);
  });

  it("exports server actions for the sign-in page", async () => {
    stubBase({ NODE_ENV: "development", AUTH_DEV_LOGIN: "true" });
    const mod = (await loadAuth()) as unknown as Record<string, unknown>;
    expect(typeof mod.signInWithEntra).toBe("function");
    expect(typeof mod.signInWithDevLogin).toBe("function");
  });
});
