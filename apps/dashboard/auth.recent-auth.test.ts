import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Source: docs/specs/2026-11-10-access-control.md - "Recent authentication"
// (D28): `authTime` is a JWT field set only in the sign-in branch of the jwt
// callback (Entra: the verified ID token's integer `auth_time`, kept as is;
// master, password, password-setup and dev login: the time the callback runs),
// never from an `update` payload, and copied read-only to
// `session.user.authTime`. An Entra token without a valid integer `auth_time`
// gets no authTime but the session is still issued. Threats T31 (client sets
// authTime) and T32 (SSO reuse / missing claim). Same harness as
// auth.r1.test.ts: next-auth is mocked to capture the callbacks.
type Rec = Record<string, unknown>;
type Config = {
  callbacks: {
    jwt: (arg: Rec) => Promise<Rec | null>;
    session: (arg: Rec) => Rec & { user?: Rec };
  };
};
const captured = vi.hoisted(() => ({ config: undefined as unknown as Config }));

vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    captured.config = config as Config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: unknown) => ({ type: "credentials", options }),
}));
vi.mock("next-auth/providers/microsoft-entra-id", () => ({
  default: { type: "oidc", id: "microsoft-entra-id" },
}));
vi.mock("@/lib/data/identity", () => ({ upsertIdentity: vi.fn() }));
vi.mock("@/lib/auth/security-events", () => ({ recordSecurityEvent: vi.fn() }));
vi.mock("@/lib/data/access/sign-in-sync", () => ({
  applySignInResolution: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/data/access/session-audit", () => ({
  recordSignIn: vi.fn().mockResolvedValue(undefined),
  recordSignOut: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/auth/master-user", () => ({
  MASTER_USER_PROVIDER_ID: "master-user",
  authorizeMasterUser: vi.fn(),
}));

const TID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const ENTRA_ENV = {
  AUTH_MICROSOFT_ENTRA_ID_ID: "client-id",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "client-secret",
  AUTH_MICROSOFT_ENTRA_ID_ISSUER: `https://login.microsoftonline.com/${TID}/v2.0`,
};
const NOW_MS = 1_793_000_000_000;
const NOW = NOW_MS / 1000;
const H = 3600;

async function loadConfig(): Promise<Config> {
  const vars: Record<string, string> = {
    SKIP_ENV_VALIDATION: "1",
    AUTH_SECRET: "test-secret",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PHASE: "",
    NODE_ENV: "development",
    APP_ENV: "dev",
    AUTH_ACCESS_MODE: "",
    AUTH_DEV_LOGIN: "",
    AUTH_MASTER_USERNAME: "",
    AUTH_MASTER_PASSWORD_HASH: "",
    AUTH_MASTER_TOTP_SECRET: "",
    ...ENTRA_ENV,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  vi.stubGlobal("window", undefined);
  vi.resetModules();
  await import("@/auth");
  return captured.config;
}

const entraProfile = (over: Rec = {}): Rec => ({
  oid: "oid-1",
  tid: TID,
  email: "ada@example.com",
  name: "Ada",
  roles: ["internal-admin"],
  ...over,
});
const entraSignIn = (profile: Rec, token: Rec = { sub: "s" }) => ({
  token,
  account: { provider: "microsoft-entra-id" },
  profile,
  user: {},
});

const credentialsSignIn = (
  provider: string,
  authMethod: "master" | "password" | "local",
  token: Rec = { sub: "s" },
) => ({
  token,
  account: { provider },
  profile: undefined,
  user: {
    id: "u1",
    oid: authMethod === "password" ? "local:uuid-1" : `${authMethod}:u1`,
    tid: authMethod === "local" ? "local" : "tid-1",
    email: "u1@example.test",
    roles: ["internal-admin"],
    authMethod,
  },
});

// A token of an established session, signed in `age` seconds ago.
const sessionToken = (age: number, extra: Rec = {}): Rec => ({
  sub: "s",
  oid: "oid-1",
  tid: TID,
  roles: ["internal-admin"],
  authMethod: "entra",
  signedInAt: NOW - age,
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("jwt callback: Entra sign-in sets authTime from auth_time", () => {
  it("takes an integer auth_time as authTime, not the callback time", async () => {
    const cfg = await loadConfig();
    const token = await cfg.callbacks.jwt(
      entraSignIn(entraProfile({ auth_time: NOW - 120 })),
    );
    expect(token?.authTime).toBe(NOW - 120);
    expect(token?.signedInAt).toBe(NOW);
  });

  it("keeps an old auth_time as it is (an Entra SSO session reused: not recent)", async () => {
    const cfg = await loadConfig();
    const token = await cfg.callbacks.jwt(
      entraSignIn(entraProfile({ auth_time: NOW - 5 * H })),
    );
    expect(token?.authTime).toBe(NOW - 5 * H);
    expect(token?.signedInAt).toBe(NOW);
  });

  it("issues a session without authTime when auth_time is missing", async () => {
    const cfg = await loadConfig();
    const token = await cfg.callbacks.jwt(entraSignIn(entraProfile()));
    expect(token).not.toBeNull();
    expect(token?.oid).toBe("oid-1");
    expect(token?.authTime).toBeUndefined();
  });

  it.each([
    ["a fraction", 1.5],
    ["a numeric string", String(NOW - 10)],
    ["NaN", Number.NaN],
    ["null", null],
    ["a boolean", true],
    ["an object", { epoch: NOW }],
  ])(
    "issues a session without authTime when auth_time is %s",
    async (_n, authTime) => {
      const cfg = await loadConfig();
      const token = await cfg.callbacks.jwt(
        entraSignIn(entraProfile({ auth_time: authTime })),
      );
      expect(token).not.toBeNull();
      expect(token?.oid).toBe("oid-1");
      expect(token?.authTime).toBeUndefined();
    },
  );

  it("does not carry a previous session's authTime into a new Entra sign-in that has none", async () => {
    const cfg = await loadConfig();
    const token = await cfg.callbacks.jwt(
      entraSignIn(entraProfile(), sessionToken(60, { authTime: NOW - 60 })),
    );
    expect(token).not.toBeNull();
    expect(token?.authTime).toBeUndefined();
  });

  it("replaces a previous session's authTime with the new sign-in's auth_time", async () => {
    const cfg = await loadConfig();
    const token = await cfg.callbacks.jwt(
      entraSignIn(
        entraProfile({ auth_time: NOW - 30 }),
        sessionToken(3 * H, { authTime: NOW - 3 * H }),
      ),
    );
    expect(token?.authTime).toBe(NOW - 30);
  });
});

describe("jwt callback: credential sign-ins set authTime to the callback time", () => {
  it.each([
    ["the master user", "master-user", "master"],
    ["a password user", "password", "password"],
    ["a password setup", "password-setup", "password"],
    ["the dev login", "dev-login", "local"],
  ] as const)("%s gets authTime = now", async (_n, provider, authMethod) => {
    const cfg = await loadConfig();
    const token = await cfg.callbacks.jwt(
      credentialsSignIn(provider, authMethod),
    );
    expect(token).not.toBeNull();
    expect(token?.authTime).toBe(NOW);
    expect(token?.signedInAt).toBe(NOW);
  });

  it("overwrites a previous session's authTime on a new credential sign-in", async () => {
    const cfg = await loadConfig();
    const token = await cfg.callbacks.jwt(
      credentialsSignIn(
        "password",
        "password",
        sessionToken(3 * H, { authTime: NOW - 3 * H, authMethod: "password" }),
      ),
    );
    expect(token?.authTime).toBe(NOW);
  });
});

describe("jwt callback: only a sign-in sets authTime", () => {
  it("keeps authTime unchanged on a later call with no account", async () => {
    const cfg = await loadConfig();
    vi.setSystemTime(NOW_MS + 600_000);
    const token = await cfg.callbacks.jwt({
      token: sessionToken(1000, { authTime: NOW - 1000 }),
    });
    expect(token?.authTime).toBe(NOW - 1000);
  });

  it("does not add authTime to a token that has none", async () => {
    const cfg = await loadConfig();
    const token = await cfg.callbacks.jwt({ token: sessionToken(1000) });
    expect(token).not.toBeNull();
    expect(token?.authTime).toBeUndefined();
  });

  it.each([
    ["authTime at the top level", { authTime: NOW }],
    ["authTime under user", { user: { authTime: NOW } }],
    ["authTime under token", { token: { authTime: NOW } }],
    ["a session that is null", null],
  ])(
    "an update trigger carrying %s leaves a stale authTime unchanged",
    async (_n, payload) => {
      const cfg = await loadConfig();
      const token = await cfg.callbacks.jwt({
        token: sessionToken(2 * H, { authTime: NOW - 2 * H }),
        session: payload,
        trigger: "update",
      });
      expect(token?.authTime).toBe(NOW - 2 * H);
    },
  );

  it("an update trigger cannot give a token with no authTime one", async () => {
    const cfg = await loadConfig();
    const token = await cfg.callbacks.jwt({
      token: sessionToken(2 * H),
      session: { authTime: NOW, user: { authTime: NOW } },
      trigger: "update",
    });
    expect(token).not.toBeNull();
    expect(token?.authTime).toBeUndefined();
  });
});

describe("session callback: user.authTime comes from the token only", () => {
  const sessionArg = (token: Rec, user: Rec = {}) => ({
    session: { expires: "2099-01-01T00:00:00.000Z", user },
    token,
  });

  it("exposes the token's authTime as session.user.authTime", async () => {
    const cfg = await loadConfig();
    const out = cfg.callbacks.session(
      sessionArg(sessionToken(60, { authTime: NOW - 60 })),
    );
    expect(out.user?.authTime).toBe(NOW - 60);
  });

  it("exposes no authTime when the token has none", async () => {
    const cfg = await loadConfig();
    const out = cfg.callbacks.session(sessionArg(sessionToken(60)));
    expect(out.user?.authTime).toBeUndefined();
  });

  it("does not take authTime from the session object or an update payload", async () => {
    const cfg = await loadConfig();
    const spoof = { authTime: NOW };
    const withTokenValue = cfg.callbacks.session({
      ...sessionArg(sessionToken(2 * H, { authTime: NOW - 2 * H }), spoof),
      newSession: { user: spoof },
      trigger: "update",
    });
    expect(withTokenValue.user?.authTime).toBe(NOW - 2 * H);
    const withoutTokenValue = cfg.callbacks.session({
      ...sessionArg(sessionToken(2 * H), spoof),
      newSession: { user: spoof },
      trigger: "update",
    });
    expect(withoutTokenValue.user?.authTime).toBeUndefined();
  });
});
