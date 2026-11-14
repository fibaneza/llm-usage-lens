import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const captured = vi.hoisted(() => ({ config: undefined as unknown as Config }));
let realParseSessionToken: (t: Rec) => unknown = () => null;
const m = vi.hoisted(() => ({
  upsertIdentity: vi.fn(),
  applySignInResolution: vi.fn(),
  recordSignIn: vi.fn(),
  recordSignOut: vi.fn(),
  recordSecurityEvent: vi.fn(),
  parseSessionToken: vi.fn(),
  authorizeMasterUser: vi.fn(),
}));
const passwordFactories = vi.hoisted(() => ({
  createPasswordProvider: vi.fn(() => ({
    id: "password",
    type: "credentials",
  })),
  createPasswordSetupProvider: vi.fn(() => ({
    id: "password-setup",
    type: "credentials",
  })),
}));
vi.mock("@/lib/auth/password-providers", () => ({
  PASSWORD_PROVIDER_ID: "password",
  PASSWORD_SETUP_PROVIDER_ID: "password-setup",
  createPasswordProvider: passwordFactories.createPasswordProvider,
  createPasswordSetupProvider: passwordFactories.createPasswordSetupProvider,
}));

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
vi.mock("@/lib/data/identity", () => ({ upsertIdentity: m.upsertIdentity }));
vi.mock("@/lib/data/access/sign-in-sync", () => ({
  applySignInResolution: m.applySignInResolution,
}));
vi.mock("@/lib/data/access/session-audit", () => ({
  recordSignIn: m.recordSignIn,
  recordSignOut: m.recordSignOut,
}));
vi.mock("@/lib/auth/security-events", () => ({
  recordSecurityEvent: m.recordSecurityEvent,
}));
vi.mock("@/lib/auth/master-user", () => ({
  MASTER_USER_PROVIDER_ID: "master-user",
  authorizeMasterUser: m.authorizeMasterUser,
}));
vi.mock("@/lib/auth/session-token", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/session-token")>();
  realParseSessionToken =
    actual.parseSessionToken as typeof realParseSessionToken;
  m.parseSessionToken.mockImplementation(realParseSessionToken);
  return { ...actual, parseSessionToken: m.parseSessionToken };
});

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
  return captured.config;
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
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  for (const fn of Object.values(m)) fn.mockReset();
  m.parseSessionToken.mockImplementation(realParseSessionToken);
  m.upsertIdentity.mockResolvedValue(undefined);
  m.applySignInResolution.mockResolvedValue({});
  m.recordSignIn.mockResolvedValue(undefined);
  m.recordSignOut.mockResolvedValue(undefined);
  m.recordSecurityEvent.mockResolvedValue(undefined);
});
afterEach(() => {
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
    expect(m.upsertIdentity).toHaveBeenCalledTimes(1);
    expect(m.applySignInResolution).toHaveBeenCalledTimes(1);
    const input = m.applySignInResolution.mock.calls[0]?.[0] as Rec;
    expect(input).toMatchObject({
      identity: { oid: "oid-1", tid: TID, authMethod: "entra" },
      groups: ["g-1", "g-2"],
      groupsOverage: false,
      expectedTid: TID,
    });
    expect(input.requestId).toEqual(expect.any(String));
    expect(input.now).toBeInstanceOf(Date);
    expect(m.upsertIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      m.applySignInResolution.mock.invocationCallOrder[0] ?? 0,
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
    expect(m.applySignInResolution.mock.calls[0]?.[0]).toMatchObject({
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
    expect(m.recordSignIn).not.toHaveBeenCalled();
  });

  it("fails the sign-in and records one auth.signin.error event when the sync throws", async () => {
    m.applySignInResolution.mockRejectedValue(new Error("transaction failed"));
    const cfg = await load(ENTRA);
    const ok = await cfg.callbacks.signIn({
      user: {},
      account: entraAccount,
      profile: entraProfile(),
    });
    expect(ok).toBe(false);
    expect(m.recordSecurityEvent).toHaveBeenCalledTimes(1);
    const event = m.recordSecurityEvent.mock.calls[0]?.[0] as Rec;
    expect(event).toMatchObject({
      action: "auth.signin.error",
      result: "failed",
      oid: "oid-1",
    });
    expect(event.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(event)).not.toContain("transaction failed");
  });

  it("still returns false when recording the error event also fails", async () => {
    m.applySignInResolution.mockRejectedValue(new Error("x"));
    m.recordSecurityEvent.mockRejectedValue(new Error("y"));
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
    expect(m.applySignInResolution).not.toHaveBeenCalled();
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
    expect(m.recordSignIn).toHaveBeenCalledTimes(1);
    expect(m.recordSignIn.mock.calls[0]?.[0]).toMatchObject({
      oid: "master:root",
      method: "master",
    });
    expect((m.recordSignIn.mock.calls[0]?.[0] as Rec).requestId).toEqual(
      expect.any(String),
    );
    expect(m.applySignInResolution).not.toHaveBeenCalled();
  });

  it("fails a master sign-in whose record cannot be persisted", async () => {
    m.recordSignIn.mockRejectedValue(new Error("put failed"));
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
    expect(m.recordSignIn.mock.calls[0]?.[0]).toMatchObject({
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
    expect(m.recordSignOut).toHaveBeenCalledTimes(1);
    expect(m.recordSignOut.mock.calls[0]?.[0]).toMatchObject({
      oid: "oid-1",
      method: "entra",
    });
    expect((m.recordSignOut.mock.calls[0]?.[0] as Rec).now).toBeInstanceOf(
      Date,
    );
  });

  it("records nothing for a token with no identity, and never throws", async () => {
    const cfg = await load(ENTRA);
    await expect(cfg.events.signOut({ token: {} })).resolves.toBeUndefined();
    expect(m.recordSignOut).not.toHaveBeenCalled();
  });

  it("does not throw when the record cannot be persisted", async () => {
    m.recordSignOut.mockRejectedValue(new Error("put failed"));
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
    expect(m.parseSessionToken).toHaveBeenCalled();
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
    m.parseSessionToken.mockReturnValue(null);
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

  it("authorized requires a session user with an oid", async () => {
    const cfg = await load(ENTRA);
    expect(cfg.callbacks.authorized({ auth: null })).toBe(false);
    expect(cfg.callbacks.authorized({ auth: { user: {} } })).toBe(false);
    expect(cfg.callbacks.authorized({ auth: { user: { oid: "" } } })).toBe(
      false,
    );
    expect(cfg.callbacks.authorized({ auth: { user: { oid: "oid-1" } } })).toBe(
      true,
    );
  });
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
    expect(passwordFactories.createPasswordProvider).toHaveBeenCalled();
    expect(passwordFactories.createPasswordSetupProvider).toHaveBeenCalled();
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
      expect(m.upsertIdentity).toHaveBeenCalledTimes(1);
      expect(m.recordSignIn).toHaveBeenCalledTimes(1);
      expect(m.recordSignIn.mock.calls[0]?.[0]).toMatchObject({
        oid: "password:ada@example.com",
        method: "password",
      });
      expect(m.applySignInResolution).not.toHaveBeenCalled();
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
    expect(m.recordSignOut.mock.calls[0]?.[0]).toMatchObject({
      method: "password",
    });
  });
});

describe("auth.signin.error shares the request's audit sequence (D18)", () => {
  it("passes one request id and one sequence object to the sync and to the error event", async () => {
    m.applySignInResolution.mockRejectedValue(new Error("transaction failed"));
    const cfg = await load(ENTRA);
    await cfg.callbacks.signIn({
      user: {},
      account: entraAccount,
      profile: entraProfile(),
    });
    const input = m.applySignInResolution.mock.calls[0]?.[0] as Rec;
    const event = m.recordSecurityEvent.mock.calls[0]?.[0] as Rec;
    expect(input.requestId).toBe(event.requestId);
    expect(input.sequence).toEqual({ next: expect.any(Number) });
    expect(event.sequence).toBe(input.sequence);
  });

  it("the error event is written after the records already written in that request", async () => {
    m.applySignInResolution.mockImplementation(
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
    const event = m.recordSecurityEvent.mock.calls[0]?.[0] as {
      sequence: { next: number };
    };
    expect(event.sequence.next).toBe(3);
  });
});
