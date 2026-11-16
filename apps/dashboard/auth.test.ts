import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEV_LOGIN_PROVIDER_ID } from "@/lib/auth/auth-config";

// Auth.js is mocked: these tests cover the wiring of the sign-in provider
// check and the roles callbacks in auth.ts, not Auth.js itself. The config
// auth.ts passes to NextAuth() is captured so its callbacks can be driven
// directly. Rule 50.3; docs/guides/auth-setup.md.
const captured = vi.hoisted(() => ({
  config: undefined as unknown,
  signIn: undefined as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    captured.config = config;
    captured.signIn = vi.fn();
    return {
      handlers: {},
      auth: vi.fn(),
      signIn: captured.signIn,
      signOut: vi.fn(),
    };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: unknown) => ({ type: "credentials", options }),
}));
vi.mock("next-auth/providers/microsoft-entra-id", () => ({
  default: { type: "oidc", id: "microsoft-entra-id" },
}));
// F7: the per-request credential-version check reads the stored credential.
const passwordStore = vi.hoisted(() => ({ getPasswordCredential: vi.fn() }));
vi.mock("@/lib/data/access/password-credentials-store", () => passwordStore);

// Hoisted state for the moved auth.r2 describe at the end of this file.
const r2m = vi.hoisted(() => ({
  upsertIdentity: vi.fn(),
  applySignInResolution: vi.fn(),
  recordSignIn: vi.fn(),
  recordSignOut: vi.fn(),
  recordSecurityEvent: vi.fn(),
  parseSessionToken: vi.fn(),
  authorizeMasterUser: vi.fn(),
}));
const r2PasswordFactories = vi.hoisted(() => ({
  createPasswordProvider: vi.fn(() => ({
    id: "password",
    type: "credentials",
  })),
  createPasswordSetupProvider: vi.fn(() => ({
    id: "password-setup",
    type: "credentials",
  })),
}));

const ENTRA = {
  AUTH_MICROSOFT_ENTRA_ID_ID: "client-id",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "client-secret",
  AUTH_MICROSOFT_ENTRA_ID_ISSUER:
    "https://login.microsoftonline.com/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/v2.0",
};

function stubBase(overrides: Record<string, string>) {
  const vars: Record<string, string> = {
    SKIP_ENV_VALIDATION: "1",
    AUTH_SECRET: "test-secret",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PHASE: "",
    APP_ENV: "dev",
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

  // Phase 4R.5 ruling 2026-11-16: auth.ts is owned elsewhere and stays as is;
  // every sign-in redirects to /dashboard and app/dashboard/page.tsx does the
  // role-aware landing (covered in app/dashboard/page.integration.test.ts).
  it.each([
    ["signInWithEntra", () => new FormData()],
    // dev login: owned and tested by L3c
    ["signInWithMasterUser", () => new FormData()],
  ])("%s redirects to /dashboard", async (action, form) => {
    stubBase({ NODE_ENV: "development", AUTH_DEV_LOGIN: "true" });
    const mod = (await loadAuth()) as unknown as Record<
      string,
      (data?: FormData) => Promise<unknown>
    >;
    await mod[action]?.(form());
    expect(captured.signIn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ redirectTo: "/dashboard" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Roles wiring. Source: docs/specs/2026-05-15-system-architecture.md —
// "Authentication & Access" → "Account-mutation role": Entra emits the app role
// in the ID token's `roles` claim and auth.ts copies it into the session as
// `session.user.roles`; the dev-only local login signs in with `Admin`. Auth
// guide — App roles / Dev-only local login. Rule 50.3. `auth.ts` Zod-parses the
// `roles` claim (a missing or malformed claim means no roles) and the session
// `maxAge` is 8 hours so a revoked Admin loses access within that window;
// implementation-phases — the `Admin` app-role amendment.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
// A jwt callback may return null, which makes Auth.js clear the session.
type RawCallback = (params: Json) => Promise<Json | null> | Json | null;
type Callback = (params: Json) => Promise<Json>;
type Authorize = (credentials: Json, request: Request) => Promise<Json | null>;
type CapturedConfig = {
  providers: {
    type?: string;
    options?: { id?: string; authorize?: Authorize };
  }[];
  session?: { strategy?: string; maxAge?: number };
  callbacks?: {
    jwt?: RawCallback;
    session?: RawCallback;
    signIn?: RawCallback;
  };
};

async function loadWithConfig(overrides: Record<string, string>) {
  stubBase(overrides);
  await loadAuth();
  return captured.config as CapturedConfig;
}

function rawCallbackOf(
  config: CapturedConfig,
  name: "jwt" | "session" | "signIn",
): RawCallback {
  const callback = config.callbacks?.[name];
  if (typeof callback !== "function") {
    throw new Error(`auth.ts must register a ${name} callback`);
  }
  return callback;
}

// For the roles tests: the callback must produce a token/session. A null
// result (the session was rejected) fails the test with a clear message.
function callbackOf(config: CapturedConfig, name: "jwt" | "session"): Callback {
  const raw = rawCallbackOf(config, name);
  return async (params) => {
    const result = await raw(params);
    if (result === null) {
      throw new Error(`auth.ts ${name} callback returned null`);
    }
    return result;
  };
}

function authorizeOf(config: CapturedConfig): Authorize {
  const provider = config.providers.find(
    (p) => p.options?.id === DEV_LOGIN_PROVIDER_ID,
  );
  const authorize = provider?.options?.authorize;
  if (typeof authorize !== "function") {
    throw new Error("auth.ts must register the dev-login credentials provider");
  }
  return authorize;
}

const rolesOf = (session: Json) => (session.user as Json | undefined)?.roles;

const ENTRA_ACCOUNT = { provider: "microsoft-entra-id", type: "oidc" };
const ENTRA_USER = {
  id: "entra-user-1",
  name: "Ada",
  email: "ada@company.com",
};

// What Auth.js hands the jwt callback on an Entra sign-in: `user` is the
// provider's default profile mapping (no roles), `profile` is the decoded ID
// token claims.
// Contract R1 decision 3: a valid profile carries `oid` and the configured
// `tid`; plain-object profiles get both unless the test overrides them.
const ENTRA_TID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
// A stored token that went through a real sign-in carries oid, tid and
// authMethod; parseSessionToken (T1 carry-in) rejects one that does not.
const WELL_FORMED_IDENTITY = {
  oid: "oid-1",
  tid: ENTRA_TID,
  authMethod: "entra",
};
function entraSignIn(profile: unknown, token: Json = { sub: "entra-user-1" }) {
  const full =
    typeof profile === "object" && profile !== null && !Array.isArray(profile)
      ? { oid: "oid-1", tid: ENTRA_TID, ...profile }
      : profile;
  return {
    token,
    user: ENTRA_USER,
    account: ENTRA_ACCOUNT,
    profile: full,
    trigger: "signIn",
  };
}

async function entraSignInAllowed(config: CapturedConfig, profile: unknown) {
  const params = { ...entraSignIn(profile), token: undefined };
  const outcome = await Promise.resolve(
    rawCallbackOf(
      config as CapturedConfig & { callbacks: { signIn: RawCallback } },
      "signIn" as never,
    )(params),
  ).catch(() => false);
  return outcome === true;
}

describe("auth.ts jwt callback (Entra roles claim)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves the roles claim via resolveGlobalRoles on sign-in (legacy Admin -> internal-admin in dev)", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ sub: "entra-user-1", roles: ["Admin", "Reader"] }));
    expect(token.roles).toEqual(["internal-admin"]);
  });

  it("keeps the identity fields of the token when it adds roles", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(
      entraSignIn(
        { roles: ["Admin"] },
        { sub: "entra-user-1", name: "Ada", email: "ada@company.com" },
      ),
    );
    expect(token).toMatchObject({
      sub: "entra-user-1",
      name: "Ada",
      email: "ada@company.com",
    });
  });

  it("defaults to internal-viewer when the ID token has no roles claim", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ sub: "entra-user-1", name: "Ada" }));
    expect(token.roles).toEqual(["internal-viewer"]);
  });

  it.each([
    ["a string", "Admin"],
    ["a comma-separated string", "Admin,Reader"],
    ["a number", 7],
    ["a boolean", true],
    ["an object", { 0: "Admin" }],
    ["null", null],
  ])(
    "gives no session when the roles claim is %s (fail closed)",
    async (_n, roles) => {
      const config = await loadWithConfig({
        NODE_ENV: "development",
        ...ENTRA,
      });
      expect(await entraSignInAllowed(config, { roles })).toBe(false);
    },
  );

  it("defaults to internal-viewer for an array holding only non-strings", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ roles: [1, null, {}, ["Admin"]] }));
    expect(token.roles).toEqual(["internal-viewer"]);
  });

  it.each([
    ["no profile", undefined],
    ["a null profile", null],
    ["a profile that is not an object", "roles"],
  ])("gives no session when an Entra sign-in has %s", async (_n, profile) => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    expect(await entraSignInAllowed(config, profile)).toBe(false);
  });

  it("resolves roles with APP_ENV=prod: the legacy Admin alias is off", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "production",
      APP_ENV: "prod",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ roles: ["Admin", "Reader"] }));
    expect(token.roles).toEqual(["internal-viewer"]);
  });

  it("drops non-string entries of the roles claim instead of rejecting the claim", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(
      entraSignIn({
        roles: [{ name: "Admin" }, ["Admin"], "internal-auditor", 0],
      }),
    );
    expect(token.roles).toEqual(["internal-auditor"]);
  });

  it("keeps only the string entries of the roles claim", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ roles: ["Reader", 7, null, "internal-auditor"] }));
    expect(token.roles).toEqual(["internal-auditor"]);
  });

  it("never grants internal-admin to an Entra sign-in whose token carries no admin role", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ roles: ["Reader"] }));
    expect(token.roles).toEqual(["internal-viewer"]);
  });

  // A token that went through a real sign-in carries its sign-in time (System
  // Architecture — Account-mutation role); a hand-made token without one is
  // rejected, see "ends a session 8 hours after sign-in" below.
  it("keeps token.roles on later calls that carry no profile (session refresh)", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const jwt = callbackOf(config, "jwt");
    const adminToken = await jwt(entraSignIn({ roles: ["internal-admin"] }));
    const admin = await jwt({ token: adminToken });
    expect(admin.roles).toEqual(["internal-admin"]);
    const memberToken = await jwt(entraSignIn({ roles: ["Reader"] }));
    const member = await jwt({ token: memberToken });
    expect(member.roles).toEqual(["internal-viewer"]);
  });

  it("replaces stale roles on a new sign-in (a revoked Admin does not stay Admin)", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(
      entraSignIn(
        { sub: "entra-user-1" },
        { sub: "entra-user-1", roles: ["internal-admin"] },
      ),
    );
    expect(token.roles).toEqual(["internal-viewer"]);
  });
});

describe("auth.ts session callback", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const baseSession = () => ({
    user: { name: "Ada", email: "ada@company.com" },
    expires: "2099-01-01T00:00:00.000Z",
  });

  it("exposes token.roles as session.user.roles", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const session = await callbackOf(
      config,
      "session",
    )({
      session: baseSession(),
      token: {
        sub: "entra-user-1",
        ...WELL_FORMED_IDENTITY,
        roles: ["internal-admin", "internal-auditor"],
      },
    });
    expect(rolesOf(session)).toEqual(["internal-admin", "internal-auditor"]);
  });

  it("keeps the rest of the session intact", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const session = await callbackOf(
      config,
      "session",
    )({
      session: baseSession(),
      token: {
        sub: "entra-user-1",
        ...WELL_FORMED_IDENTITY,
        roles: ["internal-admin"],
      },
    });
    expect(session).toMatchObject({
      user: { name: "Ada", email: "ada@company.com" },
      expires: "2099-01-01T00:00:00.000Z",
    });
  });

  it("yields no session user for a token that predates roles (fail closed, never admin)", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const session = await callbackOf(
      config,
      "session",
    )({
      session: baseSession(),
      token: { sub: "entra-user-1", ...WELL_FORMED_IDENTITY },
    });
    expect(session.user).toBeUndefined();
  });

  it.each([
    ["a string", "Admin"],
    ["an object", { 0: "Admin" }],
    ["null", null],
  ])(
    "yields no session user when token.roles is %s (malformed token, fail closed)",
    async (_n, roles) => {
      const config = await loadWithConfig({
        NODE_ENV: "development",
        ...ENTRA,
      });
      const session = await callbackOf(
        config,
        "session",
      )({
        session: baseSession(),
        token: { sub: "entra-user-1", ...WELL_FORMED_IDENTITY, roles },
      });
      expect(session.user).toBeUndefined();
    },
  );

  it("an Entra sign-in with the Admin app role yields a session with the Admin role", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ roles: ["internal-admin"] }));
    const session = await callbackOf(
      config,
      "session",
    )({
      session: baseSession(),
      token,
    });
    expect(rolesOf(session)).toEqual(["internal-admin"]);
  });

  it("an Entra sign-in without the Admin app role yields a session without the Admin role", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ roles: ["Reader"] }));
    const session = await callbackOf(
      config,
      "session",
    )({
      session: baseSession(),
      token,
    });
    expect(rolesOf(session)).toEqual(["internal-viewer"]);
    expect(rolesOf(session)).not.toContain("internal-admin");
  });
});

describe("auth.ts dev-only local login signs in with Admin", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function devLoginAuthorize() {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      AUTH_DEV_LOGIN: "true",
    });
    const user = await authorizeOf(config)(
      {},
      new Request("http://localhost/api/auth/callback/dev-login"),
    );
    if (!user) throw new Error("dev-login authorize returned no user");
    return { config, user };
  }

  // Drives the dev login the way Auth.js does: authorize() -> jwt (with the
  // authorize result as `user` and a credentials account) -> session.
  async function devLoginSession() {
    const { config, user } = await devLoginAuthorize();
    const token = await callbackOf(
      config,
      "jwt",
    )({
      token: { sub: String(user.id), name: user.name, email: user.email },
      user,
      account: {
        provider: DEV_LOGIN_PROVIDER_ID,
        type: "credentials",
        providerAccountId: String(user.id),
      },
      trigger: "signIn",
    });
    const session = await callbackOf(
      config,
      "session",
    )({
      session: {
        user: { name: user.name, email: user.email },
        expires: "2099-01-01T00:00:00.000Z",
      },
      token,
    });
    return { user, token, session };
  }

  it("keeps the fixed local identity", async () => {
    const { user } = await devLoginAuthorize();
    expect(user).toMatchObject({
      name: "Local Developer",
      email: "dev@localhost",
      oid: "local:dev@localhost",
      tid: "local",
      authMethod: "local",
    });
  });

  it('yields a session whose roles are exactly ["internal-admin"] by default', async () => {
    const { session } = await devLoginSession();
    expect(rolesOf(session)).toEqual(["internal-admin"]);
  });

  it("signs in with the chosen role", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      AUTH_DEV_LOGIN: "true",
    });
    const user = await authorizeOf(config)(
      { role: "internal-viewer" },
      new Request("http://localhost/api/auth/callback/dev-login"),
    );
    expect(user).toMatchObject({ roles: ["internal-viewer"] });
  });

  it("registers no dev-login provider in production, so the dev Admin cannot exist there", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "production",
      ...ENTRA,
    });
    expect(
      config.providers.some((p) => p.options?.id === DEV_LOGIN_PROVIDER_ID),
    ).toBe(false);
  });
});

describe("auth.ts session lifetime", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const EIGHT_HOURS_SECONDS = 8 * 60 * 60;

  it.each([
    [
      "development with the dev login",
      { NODE_ENV: "development", AUTH_DEV_LOGIN: "true" },
    ],
    ["development with Entra ID", { NODE_ENV: "development", ...ENTRA }],
    ["production with Entra ID", { NODE_ENV: "production", ...ENTRA }],
  ])("uses a JWT session capped at 8 hours (%s)", async (_name, env) => {
    const config = await loadWithConfig(env);
    expect(config.session?.strategy).toBe("jwt");
    expect(config.session?.maxAge).toBe(EIGHT_HOURS_SECONDS);
  });
});

// ---------------------------------------------------------------------------
// Absolute session lifetime. Source: docs/specs/2026-05-15-system-architecture.md
// — "Authentication & Access" → "Account-mutation role": a session ends 8 hours
// after sign-in regardless of activity. Auth.js re-issues the JWT on every
// request, so `maxAge` alone is only an idle timeout; the jwt callback records
// the sign-in time (`signedInAt`, epoch seconds) when `account` is present and
// returns null once the token is more than 8 hours old, which makes Auth.js
// clear the session. A token with no (or a malformed) sign-in time is rejected:
// fail closed. implementation-phases — the `Admin` app-role amendment, Verify.
// Time is controlled with fake timers (Rule 60.24); only `Date` is faked so the
// dynamic module loads keep real timers.
// ---------------------------------------------------------------------------

describe("auth.ts ends a session 8 hours after sign-in, regardless of activity", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const SIGN_IN_AT = new Date("2026-10-29T01:00:00.000Z");
  const SIGN_IN_AT_SECONDS = SIGN_IN_AT.getTime() / 1000;
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;

  const setNow = (offsetMs: number) =>
    vi.setSystemTime(new Date(SIGN_IN_AT.getTime() + offsetMs));

  async function startClock(
    env: Record<string, string> = { NODE_ENV: "development", ...ENTRA },
  ) {
    const config = await loadWithConfig(env);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SIGN_IN_AT);
    return { config, jwt: rawCallbackOf(config, "jwt") };
  }

  function present(token: Json | null): Json {
    if (token === null) throw new Error("jwt callback returned null");
    return token;
  }

  const signIn = async (jwt: RawCallback, token?: Json) =>
    present(await jwt(entraSignIn({ roles: ["internal-viewer"] }, token)));

  const refresh = async (jwt: RawCallback, token: Json) =>
    present(await jwt({ token }));

  it("records the sign-in time in epoch seconds when the user signs in", async () => {
    const { jwt } = await startClock();
    const token = await signIn(jwt);
    expect(token.signedInAt).toBe(SIGN_IN_AT_SECONDS);
  });

  it("keeps the token 7 hours 59 minutes after sign-in, with its identity and roles", async () => {
    const { jwt } = await startClock();
    const token = await signIn(jwt);
    setNow(7 * HOUR + 59 * MINUTE);
    expect(await jwt({ token })).toMatchObject({
      sub: "entra-user-1",
      roles: ["internal-viewer"],
    });
  });

  it.each([
    ["1 second past 8 hours", 8 * HOUR + SECOND],
    ["9 hours", 9 * HOUR],
    ["3 days", 72 * HOUR],
  ])(
    "returns null %s after sign-in, so Auth.js clears the session",
    async (_n, elapsed) => {
      const { jwt } = await startClock();
      const token = await signIn(jwt);
      setNow(elapsed);
      expect(await jwt({ token })).toBeNull();
    },
  );

  it("does not extend the session for an active user (the token is re-issued every request)", async () => {
    const { jwt } = await startClock();
    let token = await signIn(jwt);
    for (let hour = 1; hour <= 7; hour += 1) {
      setNow(hour * HOUR);
      token = await refresh(jwt, token);
    }
    setNow(8 * HOUR + SECOND);
    expect(await jwt({ token })).toBeNull();
  });

  it("measures the age from the recorded sign-in time in epoch seconds", async () => {
    const { jwt } = await startClock();
    const stored = (agoMs: number) => ({
      sub: "entra-user-1",
      ...WELL_FORMED_IDENTITY,
      roles: ["internal-viewer"],
      signedInAt: SIGN_IN_AT_SECONDS - agoMs / 1000,
    });
    expect(await jwt({ token: stored(7 * HOUR + 59 * MINUTE) })).toMatchObject({
      roles: ["internal-viewer"],
    });
    expect(await jwt({ token: stored(8 * HOUR + SECOND) })).toBeNull();
  });

  it.each([
    ["an empty token", {}],
    [
      "identity and roles only",
      { sub: "entra-user-1", roles: ["internal-viewer"] },
    ],
    [
      "a token whose roles say Admin but that predates the sign-in time",
      {
        sub: "entra-user-1",
        name: "Ada",
        email: "a@x.test",
        roles: ["internal-viewer"],
      },
    ],
  ])(
    "returns null for %s (no sign-in time: fail closed)",
    async (_n, token) => {
      const { jwt } = await startClock();
      expect(await jwt({ token })).toBeNull();
    },
  );

  it("does not treat Auth.js's per-request iat/exp/jti as the sign-in time", async () => {
    const { jwt } = await startClock();
    expect(
      await jwt({
        token: {
          sub: "entra-user-1",
          roles: ["internal-viewer"],
          iat: SIGN_IN_AT_SECONDS,
          exp: SIGN_IN_AT_SECONDS + 8 * 60 * 60,
          jti: "per-request-id",
        },
      }),
    ).toBeNull();
  });

  it.each([
    ["a numeric string", String(SIGN_IN_AT_SECONDS)],
    ["an ISO date string", SIGN_IN_AT.toISOString()],
    ["null", null],
    ["a boolean", true],
    ["an object", {}],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])(
    "returns null when the sign-in time is %s (malformed: fail closed)",
    async (_n, signedInAt) => {
      const { jwt } = await startClock();
      expect(
        await jwt({
          token: {
            sub: "entra-user-1",
            roles: ["internal-viewer"],
            signedInAt,
          },
        }),
      ).toBeNull();
    },
  );

  it("resets the clock on a new sign-in", async () => {
    const { jwt } = await startClock();
    const first = await signIn(jwt);
    setNow(7 * HOUR);
    const refreshed = await refresh(jwt, first);

    const second = await signIn(jwt, refreshed);
    expect(second.signedInAt).toBe(SIGN_IN_AT_SECONDS + 7 * 60 * 60);

    setNow(7 * HOUR + 7 * HOUR + 59 * MINUTE);
    expect(await jwt({ token: second })).not.toBeNull();
    setNow(7 * HOUR + 8 * HOUR + SECOND);
    expect(await jwt({ token: second })).toBeNull();
  });

  it("starts a fresh session when the user signs in over an already expired token", async () => {
    const { jwt } = await startClock();
    const expired = await signIn(jwt);
    setNow(9 * HOUR);
    expect(await jwt({ token: expired })).toBeNull();

    const renewed = await signIn(jwt, expired);
    expect(renewed.signedInAt).toBe(SIGN_IN_AT_SECONDS + 9 * 60 * 60);
    setNow(9 * HOUR + 7 * HOUR + 59 * MINUTE);
    expect(await jwt({ token: renewed })).not.toBeNull();
  });

  it("applies to the dev-only local login as well", async () => {
    const { config, jwt } = await startClock({
      NODE_ENV: "development",
      AUTH_DEV_LOGIN: "true",
    });
    const user = await authorizeOf(config)(
      {},
      new Request("http://localhost/api/auth/callback/dev-login"),
    );
    const token = present(
      await jwt({
        token: { sub: String(user?.id) },
        user,
        account: {
          provider: DEV_LOGIN_PROVIDER_ID,
          type: "credentials",
          providerAccountId: String(user?.id),
        },
        trigger: "signIn",
      }),
    );
    expect(token.signedInAt).toBe(SIGN_IN_AT_SECONDS);

    // Default local role is internal-admin, whose cap is 4 hours.
    setNow(3 * HOUR + 59 * MINUTE);
    expect(await jwt({ token })).not.toBeNull();
    setNow(4 * HOUR + SECOND);
    expect(await jwt({ token })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hardening. Source: docs/specs/2026-05-15-system-architecture.md —
// "Authentication & Access" → "Account-mutation role": the jwt callback also
// rejects a token whose sign-in time is more than 60 seconds in the future
// (clock-skew allowance), because a future stamp would otherwise outlive the
// 8-hour cap; "Roles and the sign-in time change only at sign-in; a session
// `update` cannot alter them". implementation-phases — Phase 3.3 amendment,
// "Hardening". Time is controlled with fake timers (Rule 60.24).
// ---------------------------------------------------------------------------

describe("auth.ts rejects a sign-in time in the future", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const NOW = new Date("2026-10-29T01:00:00.000Z");
  const NOW_SECONDS = NOW.getTime() / 1000;
  const HOUR_SECONDS = 60 * 60;
  const YEAR_2100_SECONDS = 4_102_444_800;

  async function startClock() {
    const config = await loadWithConfig({ NODE_ENV: "development", ...ENTRA });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    return rawCallbackOf(config, "jwt");
  }

  const tokenSignedInAt = (signedInAt: number): Json => ({
    sub: "entra-user-1",
    ...WELL_FORMED_IDENTITY,
    roles: ["internal-viewer"],
    signedInAt,
  });

  it.each([
    ["at the current time", 0],
    ["30 seconds ahead", 30],
    ["exactly 60 seconds ahead (the skew allowance is inclusive)", 60],
  ])("keeps a token signed in %s", async (_n, ahead) => {
    const jwt = await startClock();
    expect(await jwt({ token: tokenSignedInAt(NOW_SECONDS + ahead) })).toEqual(
      tokenSignedInAt(NOW_SECONDS + ahead),
    );
  });

  it.each([
    ["61 seconds ahead", 61],
    ["5 minutes ahead", 5 * 60],
    ["1 hour ahead", HOUR_SECONDS],
    ["8 hours ahead", 8 * HOUR_SECONDS],
    ["1 year ahead", 365 * 24 * HOUR_SECONDS],
    ["the year 2100", YEAR_2100_SECONDS - NOW_SECONDS],
  ])(
    "returns null for a token signed in %s, so Auth.js clears the session",
    async (_n, ahead) => {
      const jwt = await startClock();
      expect(
        await jwt({ token: tokenSignedInAt(NOW_SECONDS + ahead) }),
      ).toBeNull();
    },
  );

  it("measures the allowance against the current time as it advances", async () => {
    const jwt = await startClock();
    const token = tokenSignedInAt(NOW_SECONDS + 60);
    expect(await jwt({ token })).not.toBeNull();
    vi.setSystemTime(new Date(NOW.getTime() - 1000));
    expect(await jwt({ token })).toBeNull();
  });

  it("starts a clean session when the user signs in over a future-dated token", async () => {
    const jwt = await startClock();
    const token = await jwt(
      entraSignIn(
        { roles: ["internal-viewer"] },
        {
          sub: "entra-user-1",
          ...WELL_FORMED_IDENTITY,
          signedInAt: YEAR_2100_SECONDS,
        },
      ),
    );
    expect(token).toMatchObject({
      roles: ["internal-viewer"],
      signedInAt: NOW_SECONDS,
    });
  });
});

describe("auth.ts session update cannot change roles or the sign-in time", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const NOW = new Date("2026-10-29T01:00:00.000Z");
  const NOW_SECONDS = NOW.getTime() / 1000;
  const HOUR_SECONDS = 60 * 60;

  async function startClock() {
    const config = await loadWithConfig({ NODE_ENV: "development", ...ENTRA });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    return { config, jwt: rawCallbackOf(config, "jwt") };
  }

  // What a browser can send through Auth.js's client `update(data)`: arbitrary
  // JSON reaching the jwt callback as `session` with `trigger: "update"`.
  const CLIENT_PAYLOADS: [string, unknown][] = [
    [
      "user.roles and a fresh sign-in time",
      { user: { roles: ["internal-viewer"] }, signedInAt: NOW_SECONDS },
    ],
    ["top-level roles", { roles: ["internal-viewer"] }],
    ["user.roles only", { user: { name: "Ada", roles: ["internal-viewer"] } }],
    ["a fresh sign-in time only", { signedInAt: NOW_SECONDS }],
    [
      "a nested token override",
      { token: { roles: ["internal-viewer"], signedInAt: NOW_SECONDS } },
    ],
    ["an empty object", {}],
    ["null", null],
  ];

  const memberToken = (): Json => ({
    sub: "entra-user-1",
    ...WELL_FORMED_IDENTITY,
    name: "Ada",
    email: "ada@company.com",
    roles: ["internal-viewer"],
    signedInAt: NOW_SECONDS - HOUR_SECONDS,
  });

  const update = (token: Json, session: unknown): Json => ({
    token,
    session,
    trigger: "update",
  });

  // These two already hold before the hardening; they are guards so a later
  // change that merges `session` into the token fails here.
  it.each(CLIENT_PAYLOADS)(
    "leaves token.roles unchanged on a non-admin token when the client sends %s",
    async (_n, session) => {
      const { jwt } = await startClock();
      const result = await jwt(update(memberToken(), session));
      expect(result).not.toBeNull();
      expect(result?.roles).toEqual(["internal-viewer"]);
    },
  );

  it.each(CLIENT_PAYLOADS)(
    "leaves token.signedInAt unchanged when the client sends %s",
    async (_n, session) => {
      const { jwt } = await startClock();
      const result = await jwt(update(memberToken(), session));
      expect(result?.signedInAt).toBe(NOW_SECONDS - HOUR_SECONDS);
    },
  );

  it("does not strip roles from an Admin token when the client sends an empty list", async () => {
    const { jwt } = await startClock();
    const admin = { ...memberToken(), roles: ["internal-admin"] };
    const result = await jwt(update(admin, { user: { roles: [] }, roles: [] }));
    expect(result?.roles).toEqual(["internal-admin"]);
  });

  it("keeps the rest of the token on an update", async () => {
    const { jwt } = await startClock();
    const result = await jwt(
      update(memberToken(), { user: { name: "Mallory" }, name: "Mallory" }),
    );
    expect(result).toMatchObject({
      sub: "entra-user-1",
      ...WELL_FORMED_IDENTITY,
      name: "Ada",
      email: "ada@company.com",
    });
  });

  it("returns null for an expired token even when the update carries a fresh sign-in time", async () => {
    const { jwt } = await startClock();
    const expired = {
      ...memberToken(),
      signedInAt: NOW_SECONDS - 8 * HOUR_SECONDS - 1,
    };
    expect(await jwt(update(expired, { signedInAt: NOW_SECONDS }))).toBeNull();
  });

  it("returns null for a token with no sign-in time even when the update supplies one", async () => {
    const { jwt } = await startClock();
    const withoutSignedInAt = memberToken();
    delete withoutSignedInAt.signedInAt;
    expect(
      await jwt(update(withoutSignedInAt, { signedInAt: NOW_SECONDS })),
    ).toBeNull();
  });

  it("returns null for a future-dated token on update", async () => {
    const { jwt } = await startClock();
    const future = { ...memberToken(), signedInAt: NOW_SECONDS + 3600 };
    expect(await jwt(update(future, { signedInAt: NOW_SECONDS }))).toBeNull();
  });

  it("does not extend the session: an update cannot push the 8-hour cap out", async () => {
    const { jwt } = await startClock();
    const signedIn = await jwt(entraSignIn({ roles: ["internal-viewer"] }));
    if (signedIn === null) throw new Error("jwt callback returned null");

    vi.setSystemTime(new Date(NOW.getTime() + 7 * HOUR_SECONDS * 1000));
    const updated = await jwt(
      update(signedIn, {
        signedInAt: NOW_SECONDS + 7 * HOUR_SECONDS,
      }),
    );
    expect(updated).not.toBeNull();

    vi.setSystemTime(new Date(NOW.getTime() + (8 * HOUR_SECONDS + 1) * 1000));
    expect(await jwt({ token: updated })).toBeNull();
  });

  it("the session callback ignores client-supplied update data (roles come from the token)", async () => {
    const config = await loadWithConfig({ NODE_ENV: "development", ...ENTRA });
    const session = await callbackOf(
      config,
      "session",
    )({
      session: {
        user: { name: "Ada", email: "ada@company.com" },
        expires: "2099-01-01T00:00:00.000Z",
      },
      token: {
        sub: "entra-user-1",
        ...WELL_FORMED_IDENTITY,
        roles: ["internal-viewer"],
      },
      newSession: { user: { roles: ["internal-admin"] }, roles: ["Admin"] },
      trigger: "update",
    });
    expect(rolesOf(session)).toEqual(["internal-viewer"]);
  });
});

// ---------------------------------------------------------------------------
// Runtime issuer check. Source: docs/specs/2026-05-15-system-architecture.md —
// "Authentication & Access" → "Sign-in providers": the Entra issuer must be
// tenant-specific (lowercase tenant GUID), and `auth.ts` repeats the issuer
// check at runtime with the other provider checks, so a skipped validation
// (`SKIP_ENV_VALIDATION`, set by `stubBase`) never enables Entra with the
// multi-tenant `common`, `organizations` or `consumers` issuer: loading auth.ts
// throws AuthConfigError, so every sign-in and session request fails.
// ---------------------------------------------------------------------------

describe("auth.ts runtime Entra issuer check (env validation skipped)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const TENANT = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
  const issuerFor = (tenant: string) =>
    `https://login.microsoftonline.com/${tenant}/v2.0`;
  const withIssuer = (
    issuer: string,
    nodeEnv: string,
    extra: Record<string, string> = {},
  ) => ({
    NODE_ENV: nodeEnv,
    ...ENTRA,
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: issuer,
    ...extra,
  });

  describe.each(["development", "production"])("in %s", (nodeEnv) => {
    it.each([
      ["the common issuer", issuerFor("common")],
      ["the organizations issuer", issuerFor("organizations")],
      ["the consumers issuer", issuerFor("consumers")],
      ["an uppercase tenant GUID", issuerFor(TENANT.toUpperCase())],
      ["a tenant that is not a GUID", issuerFor("tenant")],
    ])("throws AuthConfigError for %s", async (_n, issuer) => {
      stubBase(withIssuer(issuer, nodeEnv));
      await expectAuthConfigError();
    });

    it("loads with a lowercase tenant GUID and enables Entra", async () => {
      stubBase(withIssuer(issuerFor(TENANT), nodeEnv));
      const mod = await loadAuth();
      expect(mod.enabledSignInProviders.entra).toBe(true);
    });
  });

  it("does not fall back to the dev login when the issuer is rejected", async () => {
    stubBase(
      withIssuer(issuerFor("common"), "development", {
        AUTH_DEV_LOGIN: "true",
      }),
    );
    await expectAuthConfigError();
  });
});

// Per-session caps (Access Control spec - session lifetime; contract R1
// decision 4): master 1 h, internal-admin / internal-org-admin 4 h, others 8 h.
describe("auth.ts per-session lifetime caps", () => {
  const NOW = new Date("2026-11-10T00:00:00.000Z");
  const NOW_S = Math.floor(NOW.getTime() / 1000);
  const H = 3600;
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const tokenOf = (
    roles: string[],
    authMethod: string,
    ageSeconds: number,
  ) => ({
    sub: "u",
    oid: "o",
    tid: "t",
    roles,
    authMethod,
    signedInAt: NOW_S - ageSeconds,
  });

  it.each([
    ["internal-admin", "entra", 4],
    ["internal-org-admin", "entra", 4],
    ["internal-admin", "master", 1],
    ["internal-auditor", "entra", 8],
    ["internal-viewer", "local", 8],
  ])(
    "%s via %s: kept just inside %i h, rejected just past it",
    async (role, method, hours) => {
      const config = await loadWithConfig({
        NODE_ENV: "development",
        ...ENTRA,
      });
      const jwt = rawCallbackOf(config, "jwt");
      expect(
        await jwt({ token: tokenOf([role], method, hours * H - 60) }),
      ).not.toBeNull();
      expect(
        await jwt({ token: tokenOf([role], method, hours * H + 60) }),
      ).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// D29, T34 - docs/specs/2026-11-10-access-control.md,
// "Password users" (Credential version): a password session carries the
// user's `credentialVersion` from sign-in and is checked against the stored
// value on every request, uncached (Rule 60.10, ASVS 3.3). A lower token
// version, or a missing, disabled, sso-bound or different user, ends the session: the jwt
// callback returns null (Auth.js then clears it). Entra, master and dev-login
// sessions never read the store. The session that changed its own password is
// re-keyed by a server-side marker (`selfChangeSignedInAt`, written by
// changePasswordWrite) matching its own `signedInAt`; no client `update`
// payload is ever consulted (T31 pattern).
// ---------------------------------------------------------------------------
describe("auth.ts password sessions follow the stored credentialVersion (F7)", () => {
  const NOW = new Date("2026-11-15T00:00:00.000Z");
  const NOW_S = NOW.getTime() / 1000;
  beforeEach(() => {
    vi.resetModules();
    passwordStore.getPasswordCredential.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const load = async () => {
    const config = await loadWithConfig({ NODE_ENV: "development", ...ENTRA });
    return {
      jwt: rawCallbackOf(config, "jwt"),
      session: rawCallbackOf(config, "session"),
    };
  };
  const passwordToken = (over: Json = {}): Json => ({
    sub: "local:abc",
    oid: "local:abc",
    tid: "local",
    email: "ada@example.com",
    roles: [],
    authMethod: "password",
    signedInAt: NOW_S - 60,
    credentialVersion: 2,
    ...over,
  });
  const stored = (over: Json = {}) => ({
    email: "ada@example.com",
    oid: "local:abc",
    displayName: "Ada",
    status: "enabled",
    passwordHash: "hash",
    credentialVersion: 2,
    ...over,
  });
  const signIn = (user: Json = {}) => ({
    token: { sub: "local:abc" },
    account: { provider: "password" },
    profile: undefined,
    user: {
      id: "local:abc",
      oid: "local:abc",
      tid: "local",
      email: "ada@example.com",
      name: "Ada",
      roles: [],
      authMethod: "password",
      credentialVersion: 2,
      ...user,
    },
  });
  // Fail closed: a rejected read must not yield a token either.
  const outcome = async (run: () => unknown) =>
    Promise.resolve(run()).catch(() => null);

  it("a password sign-in copies credentialVersion and the email into the token, without a store read", async () => {
    const { jwt } = await load();
    const token = await jwt(signIn({ credentialVersion: 5 }));
    expect(token).toMatchObject({
      authMethod: "password",
      credentialVersion: 5,
      email: "ada@example.com",
    });
    expect(passwordStore.getPasswordCredential).not.toHaveBeenCalled();
  });

  it("a new password sign-in replaces the version of an older token", async () => {
    const { jwt } = await load();
    const token = await jwt({
      ...signIn({ credentialVersion: 4 }),
      token: passwordToken({ credentialVersion: 1 }),
    });
    expect(token?.credentialVersion).toBe(4);
  });

  it("keeps a session whose token version equals the stored one, reading the store each request", async () => {
    passwordStore.getPasswordCredential.mockResolvedValue(stored());
    const { jwt } = await load();
    expect(await jwt({ token: passwordToken() })).not.toBeNull();
    expect(await jwt({ token: passwordToken() })).not.toBeNull();
    expect(passwordStore.getPasswordCredential).toHaveBeenCalledTimes(2);
    expect(passwordStore.getPasswordCredential).toHaveBeenCalledWith(
      "ada@example.com",
    );
  });

  it.each([
    [
      "a higher stored version (password changed or reset)",
      stored({ credentialVersion: 3 }),
    ],
    ["a user who no longer exists (deleted)", null],
    ["a disabled user", stored({ status: "disabled" })],
    ["a user now bound to SSO", stored({ status: "sso-bound" })],
    [
      "a different identity under the same email",
      stored({ oid: "local:other" }),
    ],
  ])("ends the session on %s", async (_n, credential) => {
    passwordStore.getPasswordCredential.mockResolvedValue(credential);
    const { jwt } = await load();
    expect(await jwt({ token: passwordToken() })).toBeNull();
  });

  it("ends a password session whose token has no email (the lookup key)", async () => {
    passwordStore.getPasswordCredential.mockResolvedValue(stored());
    const { jwt } = await load();
    expect(
      await jwt({ token: passwordToken({ email: undefined }) }),
    ).toBeNull();
  });

  // Absent = 0 on both sides (spec - Credential version), so a session from
  // before the rollout lives until its user's first credential change.
  it("treats a token without credentialVersion as 0: kept while the item has none, ended after the first change", async () => {
    const { jwt } = await load();
    passwordStore.getPasswordCredential.mockResolvedValue(
      stored({ credentialVersion: 0 }),
    );
    expect(
      await jwt({ token: passwordToken({ credentialVersion: undefined }) }),
    ).not.toBeNull();
    passwordStore.getPasswordCredential.mockResolvedValue(
      stored({ credentialVersion: 1 }),
    );
    expect(
      await jwt({ token: passwordToken({ credentialVersion: undefined }) }),
    ).toBeNull();
  });

  it("never returns a token when the store read fails", async () => {
    passwordStore.getPasswordCredential.mockRejectedValue(new Error("down"));
    const { jwt } = await load();
    expect(await outcome(() => jwt({ token: passwordToken() }))).toBeNull();
  });

  it.each([
    ["entra", { authMethod: "entra", oid: "oid-1", tid: ENTRA_TID }],
    ["master", { authMethod: "master", oid: "master:root", tid: "local" }],
    [
      "local",
      { authMethod: "local", oid: "local:dev@localhost", tid: "local" },
    ],
  ])("a %s session never triggers the credential read", async (_n, patch) => {
    const { jwt } = await load();
    const token = await jwt({
      token: passwordToken({ ...patch, credentialVersion: undefined }),
    });
    expect(token).not.toBeNull();
    expect(passwordStore.getPasswordCredential).not.toHaveBeenCalled();
  });

  describe("an update trigger never sets or rescues the version (T31 pattern)", () => {
    const FORGED: [string, unknown][] = [
      ["top-level credentialVersion", { credentialVersion: 99 }],
      ["user.credentialVersion", { user: { credentialVersion: 99 } }],
      ["a nested token", { token: { credentialVersion: 99 } }],
      ["null", null],
    ];

    it.each(FORGED)(
      "leaves token.credentialVersion unchanged when the client sends %s",
      async (_n, session) => {
        passwordStore.getPasswordCredential.mockResolvedValue(stored());
        const { jwt } = await load();
        const token = await jwt({
          token: passwordToken(),
          session,
          trigger: "update",
        });
        expect(token?.credentialVersion).toBe(2);
      },
    );

    it.each(FORGED)(
      "does not rescue a revoked session when the client sends %s",
      async (_n, session) => {
        passwordStore.getPasswordCredential.mockResolvedValue(
          stored({ credentialVersion: 3 }),
        );
        const { jwt } = await load();
        const token = await jwt({
          token: passwordToken(),
          session,
          trigger: "update",
        });
        expect(token).toBeNull();
      },
    );
  });

  describe("the session that changed its own password stays signed in", () => {
    it("takes the stored version when the store names this session's signedInAt", async () => {
      passwordStore.getPasswordCredential.mockResolvedValue(
        stored({ credentialVersion: 3, selfChangeSignedInAt: NOW_S - 60 }),
      );
      const { jwt } = await load();
      const token = await jwt({ token: passwordToken() });
      expect(token?.credentialVersion).toBe(3);
    });

    it("keeps the new version on later requests", async () => {
      passwordStore.getPasswordCredential.mockResolvedValue(
        stored({ credentialVersion: 3, selfChangeSignedInAt: NOW_S - 60 }),
      );
      const { jwt } = await load();
      const token = await jwt({ token: passwordToken() });
      expect(await jwt({ token: token as Json })).not.toBeNull();
    });

    it("ends another session of the same user (a different signedInAt)", async () => {
      passwordStore.getPasswordCredential.mockResolvedValue(
        stored({ credentialVersion: 3, selfChangeSignedInAt: NOW_S - 60 }),
      );
      const { jwt } = await load();
      expect(
        await jwt({ token: passwordToken({ signedInAt: NOW_S - 600 }) }),
      ).toBeNull();
    });

    // D29 (user, 2026-11-15): sign-in times are compared to the millisecond, so
    // another session of the same user that signed in within the same second
    // as the changer is still ended. The marker is the value the session
    // exposes as `signedInAt` (the route stores it).
    it("ends another session of the same user that signed in within the same second, 500 ms later (D29)", async () => {
      const { jwt, session } = await load();
      const changer = await jwt(signIn({ credentialVersion: 2 }));
      vi.setSystemTime(new Date(NOW.getTime() + 500));
      const other = await jwt(signIn({ credentialVersion: 2 }));
      const exposed = (await session({
        session: { user: { name: "Ada" }, expires: "2099-01-01T00:00:00.000Z" },
        token: changer as Json,
      })) as { user: { signedInAt: number } };
      passwordStore.getPasswordCredential.mockResolvedValue(
        stored({
          credentialVersion: 3,
          selfChangeSignedInAt: exposed.user.signedInAt,
        }),
      );
      expect(await jwt({ token: changer as Json })).not.toBeNull();
      expect(await jwt({ token: other as Json })).toBeNull();
    });

    it("ends the session once a later reset has cleared the marker", async () => {
      passwordStore.getPasswordCredential.mockResolvedValue(
        stored({ credentialVersion: 4 }),
      );
      const { jwt } = await load();
      expect(
        await jwt({ token: passwordToken({ credentialVersion: 3 }) }),
      ).toBeNull();
    });
  });

  describe("session callback", () => {
    const sessionArg = (token: Json) => ({
      session: { user: { name: "Ada" }, expires: "2099-01-01T00:00:00.000Z" },
      token,
    });

    it("exposes signedInAt (the route passes it to changeOwnPassword) and never credentialVersion", async () => {
      const { session } = await load();
      const out = (await session(sessionArg(passwordToken()))) as {
        user: Json;
      };
      expect(out.user.signedInAt).toBe(NOW_S - 60);
      expect(out.user).not.toHaveProperty("credentialVersion");
    });
  });
});

describe("auth.ts callbacks: Entra sync, audit records, session token (moved from auth.r2)", () => {
  // Source: docs/specs/2026-11-10-access-control.md — "Identity, SSO mapping and
  // defaults" (sync at every Entra sign-in), "Audit log" D18 (sign-in and
  // sign-out records with the method), threats T1/T8 (a token that fails
  // parseSessionToken yields no session), T20; contract R2 §3 `auth.ts`.
  // Ruling: the Entra sign-in record (`auth.signin.success`, method entra) is
  // written inside the sync transaction (sign-in-sync.integration.test.ts), so
  // auth.ts calls `recordSignIn` for master, password and local sign-ins only;
  // calling it for Entra too would write the record twice.
  type Rec = Record<string, unknown>;
  type Config = {
    callbacks: {
      authorized: (arg: Rec) => boolean;
      signIn: (arg: Rec) => Promise<boolean>;
      jwt: (arg: Rec) => Promise<Rec | null>;
      session: (arg: Rec) => Rec;
    };
    events: { signOut: (arg: Rec) => Promise<void> };
  };
  let realParseSessionToken: (t: Rec) => unknown = () => null;
  const TID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
  const ENTRA = {
    AUTH_MICROSOFT_ENTRA_ID_ID: "client-id",
    AUTH_MICROSOFT_ENTRA_ID_SECRET: "client-secret",
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: `https://login.microsoftonline.com/${TID}/v2.0`,
  };
  const MASTER = {
    AUTH_MASTER_USERNAME: "root",
    AUTH_MASTER_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
  };
  const NOW_MS = 1_793_000_000_000;
  const NOW = NOW_MS / 1000;

  function stubBase(overrides: Record<string, string>) {
    const vars: Record<string, string> = {
      SKIP_ENV_VALIDATION: "1",
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
  async function load(env: Record<string, string>) {
    stubBase(env);
    vi.resetModules();
    await import("@/auth");
    return captured.config as Config;
  }

  const entraProfile = (over: Rec = {}) => ({
    oid: "oid-1",
    tid: TID,
    email: "Ada@Example.com",
    preferred_username: "Ada@Corp.Example",
    name: "Ada",
    roles: ["internal-auditor"],
    groups: ["g-1", "g-2"],
    ...over,
  });
  const entraAccount = { provider: "microsoft-entra-id" };
  const masterUser = {
    oid: "master:root",
    tid: "master",
    roles: ["internal-admin"],
    authMethod: "master",
  };

  beforeEach(() => {
    // File-wide vi.mock would leak into the other describes of auth.test.ts, so
    // these module mocks are registered per test and removed in afterEach.
    vi.doMock("@/lib/auth/password-providers", () => ({
      PASSWORD_PROVIDER_ID: "password",
      PASSWORD_SETUP_PROVIDER_ID: "password-setup",
      createPasswordProvider: r2PasswordFactories.createPasswordProvider,
      createPasswordSetupProvider:
        r2PasswordFactories.createPasswordSetupProvider,
    }));
    vi.doMock("@/lib/data/identity", () => ({
      upsertIdentity: r2m.upsertIdentity,
    }));
    vi.doMock("@/lib/data/access/sign-in-sync", () => ({
      applySignInResolution: r2m.applySignInResolution,
    }));
    vi.doMock("@/lib/data/access/session-audit", () => ({
      recordSignIn: r2m.recordSignIn,
      recordSignOut: r2m.recordSignOut,
    }));
    vi.doMock("@/lib/auth/security-events", () => ({
      recordSecurityEvent: r2m.recordSecurityEvent,
    }));
    vi.doMock("@/lib/auth/master-user", () => ({
      MASTER_USER_PROVIDER_ID: "master-user",
      authorizeMasterUser: r2m.authorizeMasterUser,
    }));
    vi.doMock("@/lib/auth/session-token", async (orig) => {
      const actual = await orig<typeof import("@/lib/auth/session-token")>();
      realParseSessionToken =
        actual.parseSessionToken as typeof realParseSessionToken;
      r2m.parseSessionToken.mockImplementation(realParseSessionToken);
      return { ...actual, parseSessionToken: r2m.parseSessionToken };
    });
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    for (const fn of Object.values(r2m)) fn.mockReset();
    r2m.parseSessionToken.mockImplementation(realParseSessionToken);
    r2m.upsertIdentity.mockResolvedValue(undefined);
    r2m.applySignInResolution.mockResolvedValue({});
    r2m.recordSignIn.mockResolvedValue(undefined);
    r2m.recordSignOut.mockResolvedValue(undefined);
    r2m.recordSecurityEvent.mockResolvedValue(undefined);
  });
  afterEach(() => {
    for (const id of [
      "@/lib/auth/password-providers",
      "@/lib/data/identity",
      "@/lib/data/access/sign-in-sync",
      "@/lib/data/access/session-audit",
      "@/lib/auth/security-events",
      "@/lib/auth/master-user",
      "@/lib/auth/session-token",
    ]) {
      vi.doUnmock(id);
    }
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("signIn callback: Entra sync", () => {
    it("upserts, then applies the sign-in resolution once with the claims, the tenant and a server request id", async () => {
      const cfg = await load(ENTRA);
      const ok = await cfg.callbacks.signIn({
        user: {},
        account: entraAccount,
        profile: entraProfile(),
      });
      expect(ok).toBe(true);
      expect(r2m.upsertIdentity).toHaveBeenCalledTimes(1);
      expect(r2m.applySignInResolution).toHaveBeenCalledTimes(1);
      const input = r2m.applySignInResolution.mock.calls[0]?.[0] as Rec;
      expect(input).toMatchObject({
        identity: { oid: "oid-1", tid: TID, authMethod: "entra" },
        groups: ["g-1", "g-2"],
        groupsOverage: false,
        expectedTid: TID,
      });
      expect(input.requestId).toEqual(expect.any(String));
      expect(input.now).toBeInstanceOf(Date);
      expect(r2m.upsertIdentity.mock.invocationCallOrder[0]).toBeLessThan(
        r2m.applySignInResolution.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it("passes the overage flag and no groups when the token carries a groups overage", async () => {
      const cfg = await load(ENTRA);
      await cfg.callbacks.signIn({
        user: {},
        account: entraAccount,
        profile: entraProfile({
          groups: undefined,
          _claim_names: { groups: "src1" },
        }),
      });
      expect(r2m.applySignInResolution.mock.calls[0]?.[0]).toMatchObject({
        groups: [],
        groupsOverage: true,
      });
    });

    it("does not write a second sign-in record for Entra (the sync writes it)", async () => {
      const cfg = await load(ENTRA);
      await cfg.callbacks.signIn({
        user: {},
        account: entraAccount,
        profile: entraProfile(),
      });
      expect(r2m.recordSignIn).not.toHaveBeenCalled();
    });

    it("fails the sign-in and records one auth.signin.error event when the sync throws", async () => {
      r2m.applySignInResolution.mockRejectedValue(
        new Error("transaction failed"),
      );
      const cfg = await load(ENTRA);
      const ok = await cfg.callbacks.signIn({
        user: {},
        account: entraAccount,
        profile: entraProfile(),
      });
      expect(ok).toBe(false);
      expect(r2m.recordSecurityEvent).toHaveBeenCalledTimes(1);
      const event = r2m.recordSecurityEvent.mock.calls[0]?.[0] as Rec;
      expect(event).toMatchObject({
        action: "auth.signin.error",
        result: "failed",
        oid: "oid-1",
      });
      expect(event.requestId).toEqual(expect.any(String));
      expect(JSON.stringify(event)).not.toContain("transaction failed");
    });

    it("still returns false when recording the error event also fails", async () => {
      r2m.applySignInResolution.mockRejectedValue(new Error("x"));
      r2m.recordSecurityEvent.mockRejectedValue(new Error("y"));
      const cfg = await load(ENTRA);
      await expect(
        cfg.callbacks.signIn({
          user: {},
          account: entraAccount,
          profile: entraProfile(),
        }),
      ).resolves.toBe(false);
    });

    it("does not run the sync for an invalid Entra token", async () => {
      const cfg = await load(ENTRA);
      const ok = await cfg.callbacks.signIn({
        user: {},
        account: entraAccount,
        profile: entraProfile({ tid: "11111111-1111-1111-1111-111111111111" }),
      });
      expect(ok).toBe(false);
      expect(r2m.applySignInResolution).not.toHaveBeenCalled();
    });
  });

  describe("signIn callback: other methods record the sign-in (D18)", () => {
    it("a master sign-in records method master, without running the Entra sync", async () => {
      const cfg = await load({ ...MASTER });
      const ok = await cfg.callbacks.signIn({
        user: masterUser,
        account: { provider: "master-user" },
      });
      expect(ok).toBe(true);
      expect(r2m.recordSignIn).toHaveBeenCalledTimes(1);
      expect(r2m.recordSignIn.mock.calls[0]?.[0]).toMatchObject({
        oid: "master:root",
        method: "master",
      });
      expect((r2m.recordSignIn.mock.calls[0]?.[0] as Rec).requestId).toEqual(
        expect.any(String),
      );
      expect(r2m.applySignInResolution).not.toHaveBeenCalled();
    });

    it("fails a master sign-in whose record cannot be persisted", async () => {
      r2m.recordSignIn.mockRejectedValue(new Error("put failed"));
      const cfg = await load({ ...MASTER });
      await expect(
        cfg.callbacks.signIn({
          user: masterUser,
          account: { provider: "master-user" },
        }),
      ).resolves.toBe(false);
    });

    it("a dev (local) sign-in records method local", async () => {
      const cfg = await load({ AUTH_DEV_LOGIN: "true" });
      const ok = await cfg.callbacks.signIn({
        user: {
          oid: "local:dev@localhost",
          tid: "local",
          roles: ["internal-viewer"],
          authMethod: "local",
        },
        account: { provider: "dev-login" },
      });
      expect(ok).toBe(true);
      expect(r2m.recordSignIn.mock.calls[0]?.[0]).toMatchObject({
        oid: "local:dev@localhost",
        method: "local",
      });
    });
  });

  describe("sign-out event (D18)", () => {
    it("records auth.signout with the oid and method from the token", async () => {
      const cfg = await load(ENTRA);
      await cfg.events.signOut({
        token: { oid: "oid-1", tid: TID, roles: [], authMethod: "entra" },
      });
      expect(r2m.recordSignOut).toHaveBeenCalledTimes(1);
      expect(r2m.recordSignOut.mock.calls[0]?.[0]).toMatchObject({
        oid: "oid-1",
        method: "entra",
      });
      expect((r2m.recordSignOut.mock.calls[0]?.[0] as Rec).now).toBeInstanceOf(
        Date,
      );
    });

    it("records nothing for a token with no identity, and never throws", async () => {
      const cfg = await load(ENTRA);
      await expect(cfg.events.signOut({ token: {} })).resolves.toBeUndefined();
      expect(r2m.recordSignOut).not.toHaveBeenCalled();
    });

    it("does not throw when the record cannot be persisted", async () => {
      r2m.recordSignOut.mockRejectedValue(new Error("put failed"));
      const cfg = await load(ENTRA);
      await expect(
        cfg.events.signOut({
          token: { oid: "oid-1", tid: TID, roles: [], authMethod: "entra" },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("token and session fail closed (T1, T8)", () => {
    const aged = (over: Rec = {}) => ({
      oid: "oid-1",
      tid: TID,
      roles: ["internal-viewer"],
      authMethod: "entra",
      signedInAt: NOW - 60,
      ...over,
    });

    it("jwt keeps a well-formed token", async () => {
      const cfg = await load(ENTRA);
      expect(await cfg.callbacks.jwt({ token: aged() })).not.toBeNull();
      expect(r2m.parseSessionToken).toHaveBeenCalled();
    });

    it.each([
      ["no oid", { oid: undefined }],
      ["no authMethod", { authMethod: undefined }],
      ["no tid", { tid: undefined }],
    ])("jwt returns null for a recent token with %s", async (_n, over) => {
      const cfg = await load(ENTRA);
      expect(await cfg.callbacks.jwt({ token: aged(over) })).toBeNull();
    });

    it("jwt returns null when parseSessionToken rejects the token", async () => {
      const cfg = await load(ENTRA);
      r2m.parseSessionToken.mockReturnValue(null);
      expect(await cfg.callbacks.jwt({ token: aged() })).toBeNull();
    });

    it("session has no user for a token that fails parseSessionToken", async () => {
      const cfg = await load(ENTRA);
      const out = cfg.callbacks.session({
        session: { user: { name: "Ada" }, expires: "E" },
        token: { roles: ["internal-admin"] },
      });
      expect(out.user).toBeUndefined();
      expect(out.expires).toBe("E");
    });

    it("session still exposes the user for a valid token", async () => {
      const cfg = await load(ENTRA);
      const out = cfg.callbacks.session({
        session: { user: { name: "Ada" }, expires: "E" },
        token: aged(),
      });
      expect(out.user).toMatchObject({
        oid: "oid-1",
        tid: TID,
        authMethod: "entra",
      });
    });

    const at = (path: string) => ({
      nextUrl: new URL(`http://localhost${path}`),
    });

    it("authorized requires a session user with an oid", async () => {
      const cfg = await load(ENTRA);
      const request = at("/dashboard");
      expect(cfg.callbacks.authorized({ auth: null, request })).toBe(false);
      expect(cfg.callbacks.authorized({ auth: { user: {} }, request })).toBe(
        false,
      );
      expect(
        cfg.callbacks.authorized({ auth: { user: { oid: "" } }, request }),
      ).toBe(false);
      expect(
        cfg.callbacks.authorized({ auth: { user: { oid: "oid-1" } }, request }),
      ).toBe(true);
    });

    // Rule 50.4 / Data Model "API Routes": a logged-out /api/* request gets the
    // same 401 body and Cache-Control as withRoute, not a redirect to /sign-in.
    it.each(["/api/overview", "/api/accounts/x", "/api/"])(
      "authorized answers a logged-out %s with a no-store 401",
      async (path) => {
        const cfg = await load(ENTRA);
        for (const auth of [null, { user: {} }, { user: { oid: "" } }]) {
          const out = cfg.callbacks.authorized({
            auth,
            request: at(path),
          }) as unknown;
          expect(out).toBeInstanceOf(Response);
          const res = out as Response;
          expect(res.status).toBe(401);
          expect(res.headers.get("Cache-Control")).toBe("private, no-store");
          await expect(res.json()).resolves.toEqual({
            error: { code: "UNAUTHORIZED", message: "Not authenticated" },
          });
        }
      },
    );

    it("authorized lets a signed-in /api/* request through", async () => {
      const cfg = await load(ENTRA);
      expect(
        cfg.callbacks.authorized({
          auth: { user: { oid: "oid-1" } },
          request: at("/api/overview"),
        }),
      ).toBe(true);
    });

    it.each(["/apix", "/dashboard/api/x"])(
      "authorized keeps the redirect (false) for non-API path %s",
      async (path) => {
        const cfg = await load(ENTRA);
        expect(
          cfg.callbacks.authorized({ auth: null, request: at(path) }),
        ).toBe(false);
      },
    );
  });

  describe("password providers (Access Control — Password users, D18, D25)", () => {
    const passwordUser = {
      oid: "password:ada@example.com",
      tid: "password",
      email: "ada@example.com",
      authMethod: "password",
    };

    it("registers the password and password-setup providers", async () => {
      const cfg = (await load({ ...MASTER })) as unknown as {
        providers: { id?: string }[];
      };
      const ids = cfg.providers.map((p) => p.id);
      expect(ids).toContain("password");
      expect(ids).toContain("password-setup");
      expect(r2PasswordFactories.createPasswordProvider).toHaveBeenCalled();
      expect(
        r2PasswordFactories.createPasswordSetupProvider,
      ).toHaveBeenCalled();
    });

    it.each(["password", "password-setup"])(
      "a %s sign-in records method password without the Entra sync",
      async (provider) => {
        const cfg = await load({ ...MASTER });
        const ok = await cfg.callbacks.signIn({
          user: passwordUser,
          account: { provider },
        });
        expect(ok).toBe(true);
        expect(r2m.upsertIdentity).toHaveBeenCalledTimes(1);
        expect(r2m.recordSignIn).toHaveBeenCalledTimes(1);
        expect(r2m.recordSignIn.mock.calls[0]?.[0]).toMatchObject({
          oid: "password:ada@example.com",
          method: "password",
        });
        expect(r2m.applySignInResolution).not.toHaveBeenCalled();
      },
    );

    it.each(["password", "password-setup"])(
      "the %s sign-in fails when the user carries no oid",
      async (provider) => {
        const cfg = await load({ ...MASTER });
        const ok = await cfg.callbacks.signIn({
          user: { ...passwordUser, oid: undefined },
          account: { provider },
        });
        expect(ok).toBe(false);
      },
    );

    it("the jwt carries authMethod password and passes parseSessionToken", async () => {
      const cfg = await load({ ...MASTER });
      const token = await cfg.callbacks.jwt({
        token: {},
        account: { provider: "password" },
        user: passwordUser,
      });
      expect(token).toMatchObject({
        oid: "password:ada@example.com",
        tid: "password",
        authMethod: "password",
      });
      expect(realParseSessionToken(token as Rec)).not.toBeNull();
    });

    it("the session exposes authMethod password for such a token", async () => {
      const cfg = await load({ ...MASTER });
      const out = cfg.callbacks.session({
        session: { user: { name: "Ada" }, expires: "E" },
        token: {
          oid: "password:ada@example.com",
          tid: "password",
          roles: [],
          authMethod: "password",
          signedInAt: NOW - 60,
        },
      });
      expect(out.user).toMatchObject({ authMethod: "password" });
    });

    it("records password sign-out with the method", async () => {
      const cfg = await load({ ...MASTER });
      await cfg.events.signOut({
        token: {
          oid: "password:ada@example.com",
          tid: "password",
          roles: [],
          authMethod: "password",
        },
      });
      expect(r2m.recordSignOut.mock.calls[0]?.[0]).toMatchObject({
        method: "password",
      });
    });
  });

  describe("auth.signin.error shares the request's audit sequence (D18)", () => {
    it("passes one request id and one sequence object to the sync and to the error event", async () => {
      r2m.applySignInResolution.mockRejectedValue(
        new Error("transaction failed"),
      );
      const cfg = await load(ENTRA);
      await cfg.callbacks.signIn({
        user: {},
        account: entraAccount,
        profile: entraProfile(),
      });
      const input = r2m.applySignInResolution.mock.calls[0]?.[0] as Rec;
      const event = r2m.recordSecurityEvent.mock.calls[0]?.[0] as Rec;
      expect(input.requestId).toBe(event.requestId);
      expect(input.sequence).toEqual({ next: expect.any(Number) });
      expect(event.sequence).toBe(input.sequence);
    });

    it("the error event is written after the records already written in that request", async () => {
      r2m.applySignInResolution.mockImplementation(
        async (input: { sequence: { next: number } }) => {
          input.sequence.next = 3;
          throw new Error("deliver failed");
        },
      );
      const cfg = await load(ENTRA);
      await cfg.callbacks.signIn({
        user: {},
        account: entraAccount,
        profile: entraProfile(),
      });
      const event = r2m.recordSecurityEvent.mock.calls[0]?.[0] as {
        sequence: { next: number };
      };
      expect(event.sequence.next).toBe(3);
    });
  });
});
