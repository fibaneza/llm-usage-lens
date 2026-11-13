import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEV_LOGIN_PROVIDER_ID } from "@/lib/auth/auth-config";

// Auth.js is mocked: these tests cover the wiring of the sign-in provider
// check and the roles callbacks in auth.ts, not Auth.js itself. The config
// auth.ts passes to NextAuth() is captured so its callbacks can be driven
// directly. Rule 50.3; docs/guides/auth-setup.md.
const captured = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    captured.config = config;
    return {
      handlers: {},
      auth: vi.fn(),
      signIn: vi.fn(),
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
  providers: { type?: string; options?: { authorize?: Authorize } }[];
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
  const provider = config.providers.find((p) => p.type === "credentials");
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
    expect(config.providers.some((p) => p.type === "credentials")).toBe(false);
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
