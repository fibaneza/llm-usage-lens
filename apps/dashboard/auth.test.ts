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
  callbacks?: { jwt?: RawCallback; session?: RawCallback };
};

async function loadWithConfig(overrides: Record<string, string>) {
  stubBase(overrides);
  await loadAuth();
  return captured.config as CapturedConfig;
}

function rawCallbackOf(
  config: CapturedConfig,
  name: "jwt" | "session",
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
function entraSignIn(profile: unknown, token: Json = { sub: "entra-user-1" }) {
  return {
    token,
    user: ENTRA_USER,
    account: ENTRA_ACCOUNT,
    profile,
    trigger: "signIn",
  };
}

describe("auth.ts jwt callback (Entra roles claim)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("copies the roles claim of the Entra ID token into token.roles on sign-in", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ sub: "entra-user-1", roles: ["Admin", "Reader"] }));
    expect(token.roles).toEqual(["Admin", "Reader"]);
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

  it("stores an empty list when the ID token has no roles claim", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ sub: "entra-user-1", name: "Ada" }));
    expect(token.roles).toEqual([]);
  });

  it.each([
    ["a string", "Admin"],
    ["a comma-separated string", "Admin,Reader"],
    ["a number", 7],
    ["a boolean", true],
    ["an object", { 0: "Admin" }],
    ["null", null],
    ["an array holding only non-strings", [1, null, {}, ["Admin"]]],
  ])("stores an empty list when the roles claim is %s", async (_n, roles) => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(config, "jwt")(entraSignIn({ roles }));
    expect(token.roles).toEqual([]);
  });

  it.each([
    ["no profile", undefined],
    ["a null profile", null],
    ["a profile that is not an object", "roles"],
  ])(
    "stores an empty list and does not throw when an Entra sign-in has %s",
    async (_n, profile) => {
      const config = await loadWithConfig({
        NODE_ENV: "development",
        ...ENTRA,
      });
      const token = await callbackOf(config, "jwt")(entraSignIn(profile));
      expect(token.roles).toEqual([]);
    },
  );

  it("drops non-string entries of the roles claim instead of rejecting the claim", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ roles: [{ name: "Admin" }, ["Admin"], "Admin", 0] }));
    expect(token.roles).toEqual(["Admin"]);
  });

  it("keeps only the string entries of the roles claim", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ roles: ["Reader", 7, null, "Admin"] }));
    expect(token.roles).toEqual(["Reader", "Admin"]);
  });

  it("never grants Admin to an Entra sign-in whose token carries no Admin role", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      AUTH_DEV_LOGIN: "true",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ roles: ["Reader"] }));
    expect(token.roles).toEqual(["Reader"]);
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
    const adminToken = await jwt(entraSignIn({ roles: ["Admin"] }));
    const admin = await jwt({ token: adminToken });
    expect(admin.roles).toEqual(["Admin"]);
    const memberToken = await jwt(entraSignIn({ roles: ["Reader"] }));
    const member = await jwt({ token: memberToken });
    expect(member.roles).toEqual(["Reader"]);
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
        { sub: "entra-user-1", roles: ["Admin"] },
      ),
    );
    expect(token.roles).toEqual([]);
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
      token: { sub: "entra-user-1", roles: ["Admin", "Reader"] },
    });
    expect(rolesOf(session)).toEqual(["Admin", "Reader"]);
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
      token: { sub: "entra-user-1", roles: ["Admin"] },
    });
    expect(session).toMatchObject({
      user: { name: "Ada", email: "ada@company.com" },
      expires: "2099-01-01T00:00:00.000Z",
    });
  });

  it("exposes an empty list (never undefined) for a token that predates roles", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const session = await callbackOf(
      config,
      "session",
    )({
      session: baseSession(),
      token: { sub: "entra-user-1" },
    });
    expect(rolesOf(session)).toEqual([]);
  });

  it.each([
    ["a string", "Admin"],
    ["an object", { 0: "Admin" }],
    ["null", null],
  ])("exposes an empty list when token.roles is %s", async (_n, roles) => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const session = await callbackOf(
      config,
      "session",
    )({
      session: baseSession(),
      token: { sub: "entra-user-1", roles },
    });
    expect(rolesOf(session)).toEqual([]);
  });

  it("an Entra sign-in with the Admin app role yields a session with the Admin role", async () => {
    const config = await loadWithConfig({
      NODE_ENV: "development",
      ...ENTRA,
    });
    const token = await callbackOf(
      config,
      "jwt",
    )(entraSignIn({ roles: ["Admin"] }));
    const session = await callbackOf(
      config,
      "session",
    )({
      session: baseSession(),
      token,
    });
    expect(rolesOf(session)).toEqual(["Admin"]);
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
    expect(rolesOf(session)).toEqual(["Reader"]);
    expect(rolesOf(session)).not.toContain("Admin");
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
      id: "local-developer",
      name: "Local Developer",
      email: "dev@localhost",
    });
  });

  it('yields a session whose roles are exactly ["Admin"]', async () => {
    const { session } = await devLoginSession();
    expect(rolesOf(session)).toEqual(["Admin"]);
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
    present(await jwt(entraSignIn({ roles: ["Admin"] }, token)));

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
      roles: ["Admin"],
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
      roles: ["Admin"],
      signedInAt: SIGN_IN_AT_SECONDS - agoMs / 1000,
    });
    expect(await jwt({ token: stored(7 * HOUR + 59 * MINUTE) })).toMatchObject({
      roles: ["Admin"],
    });
    expect(await jwt({ token: stored(8 * HOUR + SECOND) })).toBeNull();
  });

  it.each([
    ["an empty token", {}],
    ["identity and roles only", { sub: "entra-user-1", roles: ["Admin"] }],
    [
      "a token whose roles say Admin but that predates the sign-in time",
      { sub: "entra-user-1", name: "Ada", email: "a@x.test", roles: ["Admin"] },
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
          roles: ["Admin"],
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
          token: { sub: "entra-user-1", roles: ["Admin"], signedInAt },
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

    setNow(7 * HOUR + 59 * MINUTE);
    expect(await jwt({ token })).not.toBeNull();
    setNow(8 * HOUR + SECOND);
    expect(await jwt({ token })).toBeNull();
  });
});
