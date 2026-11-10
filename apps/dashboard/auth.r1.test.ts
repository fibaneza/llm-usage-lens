import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Source: docs/specs/2026-11-10-access-control.md — Identity, SSO mapping and
// defaults; Sign-in methods; Threat model T1, T7. Contract R1 decisions 2-5,
// 7, 9. Stream B modules are mocked with the agreed signatures.
type Rec = Record<string, unknown>;
type Config = {
  pages: Record<string, string>;
  providers: {
    options?: { id?: string; authorize: (c: unknown) => Promise<Rec | null> };
  }[];
  callbacks: {
    signIn: (arg: Rec) => Promise<boolean>;
    jwt: (arg: Rec) => Promise<Rec | null>;
    session: (arg: Rec) => { user: Rec };
  };
};
const captured = vi.hoisted(() => ({ config: undefined as unknown as Config }));
const upsertIdentity = vi.hoisted(() => vi.fn());
const authorizeMasterUser = vi.hoisted(() => vi.fn());
const recordSecurityEvent = vi.hoisted(() => vi.fn());

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
vi.mock("@/lib/data/identity", () => ({ upsertIdentity }));
vi.mock("@/lib/auth/security-events", () => ({ recordSecurityEvent }));
vi.mock("@/lib/auth/master-user", () => ({
  MASTER_USER_PROVIDER_ID: "master-user",
  authorizeMasterUser,
}));

const TID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const ENTRA = {
  AUTH_MICROSOFT_ENTRA_ID_ID: "client-id",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "client-secret",
  AUTH_MICROSOFT_ENTRA_ID_ISSUER: `https://login.microsoftonline.com/${TID}/v2.0`,
};
const NOW_MS = 1_793_000_000_000;
const NOW = NOW_MS / 1000;
const H = 3600;

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

const entraProfile = (over: Record<string, unknown> = {}) => ({
  oid: "oid-1",
  tid: TID,
  email: "Ada@Example.com",
  name: "Ada",
  roles: ["internal-auditor"],
  ...over,
});
const entraAccount = { provider: "microsoft-entra-id" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  upsertIdentity.mockReset().mockResolvedValue(undefined);
  authorizeMasterUser.mockReset();
  recordSecurityEvent.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("auth.ts config", () => {
  it("sends failed sign-ins to /no-access (pages.error)", async () => {
    const cfg = await load({ AUTH_DEV_LOGIN: "true" });
    expect(cfg.pages.error).toBe("/no-access");
    expect(cfg.pages.signIn).toBe("/sign-in");
  });

  it("registers the master-user provider only when configured", async () => {
    const without = await load(ENTRA);
    expect(
      without.providers.some(
        (p: Config["providers"][number]) => p.options?.id === "master-user",
      ),
    ).toBe(false);
    const withMaster = await load({
      ...ENTRA,
      AUTH_MASTER_USERNAME: "root",
      AUTH_MASTER_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
    });
    expect(
      withMaster.providers.some(
        (p: Config["providers"][number]) => p.options?.id === "master-user",
      ),
    ).toBe(true);
  });

  it("does not register the dev login when Entra is configured", async () => {
    stubBase({ ...ENTRA, AUTH_DEV_LOGIN: "true" });
    vi.resetModules();
    await expect(import("@/auth")).rejects.toThrow();
  });
});

describe("local login (dev only)", () => {
  const authorize = async (creds: unknown) => {
    const cfg = await load({ AUTH_DEV_LOGIN: "true" });
    const p = cfg.providers.find((x) => x.options?.id === "dev-login");
    if (!p?.options) throw new Error("dev-login provider not registered");
    return p.options.authorize(creds);
  };

  it("defaults to internal-admin with a local oid and tid", async () => {
    const user = await authorize({});
    expect(user).toMatchObject({
      oid: "local:dev@localhost",
      tid: "local",
      authMethod: "local",
      roles: ["internal-admin"],
    });
  });

  it.each([
    "internal-admin",
    "internal-org-admin",
    "internal-auditor",
    "internal-viewer",
  ])("signs in with the chosen role %s", async (role) => {
    expect(await authorize({ role })).toMatchObject({ roles: [role] });
  });

  it.each(["Admin", "internal-team-admin", "root", ""])(
    "fails sign-in for the role %j",
    async (role) => {
      const out = await authorize({ role });
      expect(out ?? null).toBeNull();
    },
  );
});

describe("signIn callback", () => {
  it("upserts the identity and allows a valid Entra sign-in", async () => {
    const cfg = await load(ENTRA);
    const ok = await cfg.callbacks.signIn({
      user: {},
      account: entraAccount,
      profile: entraProfile(),
    });
    expect(ok).toBe(true);
    expect(upsertIdentity).toHaveBeenCalledTimes(1);
    expect(upsertIdentity.mock.calls[0]?.[0]).toMatchObject({
      oid: "oid-1",
      tid: TID,
      email: "ada@example.com",
      authMethod: "entra",
      roles: ["internal-auditor"],
    });
    expect(upsertIdentity.mock.calls[0]?.[1]).toBeInstanceOf(Date);
  });

  it.each([
    ["no oid", { oid: undefined }],
    ["foreign tenant", { tid: "11111111-1111-1111-1111-111111111111" }],
    ["roles not an array", { roles: "internal-admin" }],
    ["groups not an array", { groups: "g" }],
  ])("fails closed for %s without touching the store", async (_n, over) => {
    const cfg = await load(ENTRA);
    const ok = await cfg.callbacks.signIn({
      user: {},
      account: entraAccount,
      profile: entraProfile(over),
    });
    expect(ok).not.toBe(true);
    expect(upsertIdentity).not.toHaveBeenCalled();
  });

  it("fails the sign-in when the identity upsert fails", async () => {
    upsertIdentity.mockRejectedValue(new Error("ddb down"));
    const cfg = await load(ENTRA);
    const outcome = await Promise.resolve(
      cfg.callbacks.signIn({
        user: {},
        account: entraAccount,
        profile: entraProfile(),
      }),
    ).catch(() => false);
    expect(outcome).not.toBe(true);
  });

  it("emits one id-only auth.signin.error event and still returns false when the upsert throws", async () => {
    upsertIdentity.mockRejectedValue(new Error("ddb down"));
    const cfg = await load(ENTRA);
    const ok = await cfg.callbacks.signIn({
      user: {},
      account: entraAccount,
      profile: entraProfile(),
    });
    expect(ok).toBe(false);
    expect(recordSecurityEvent).toHaveBeenCalledTimes(1);
    const ev = recordSecurityEvent.mock.calls[0]?.[0] as Rec;
    expect(ev).toMatchObject({
      action: "auth.signin.error",
      result: "failed",
      oid: "oid-1",
    });
    const blob = JSON.stringify(ev);
    expect(blob).not.toContain("ada@example.com");
    expect(blob).not.toContain("ddb down");
  });

  it("emits the error event for a failed local sign-in upsert too", async () => {
    upsertIdentity.mockRejectedValue(new Error("ddb down"));
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
    expect(ok).toBe(false);
    expect(recordSecurityEvent).toHaveBeenCalledTimes(1);
    expect(recordSecurityEvent.mock.calls[0]?.[0]).toMatchObject({
      action: "auth.signin.error",
      result: "failed",
      oid: "local:dev@localhost",
    });
  });

  it("emits no error event when the upsert succeeds", async () => {
    const cfg = await load(ENTRA);
    await cfg.callbacks.signIn({
      user: {},
      account: entraAccount,
      profile: entraProfile(),
    });
    expect(recordSecurityEvent).not.toHaveBeenCalled();
  });

  it("upserts local and master sign-ins too", async () => {
    const cfg = await load({ AUTH_DEV_LOGIN: "true" });
    const user = {
      oid: "local:dev@localhost",
      tid: "local",
      roles: ["internal-viewer"],
      authMethod: "local",
    };
    expect(
      await cfg.callbacks.signIn({
        user,
        account: { provider: "dev-login" },
      }),
    ).toBe(true);
    expect(upsertIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        oid: "local:dev@localhost",
        authMethod: "local",
      }),
      expect.any(Date),
    );
  });
});

describe("jwt callback", () => {
  it("stores oid, tid, effective roles, authMethod and signedInAt on Entra sign-in", async () => {
    const cfg = await load(ENTRA);
    const token = await cfg.callbacks.jwt({
      token: {},
      account: entraAccount,
      profile: entraProfile({ roles: ["internal-org-admin", "bogus"] }),
    });
    expect(token).toMatchObject({
      oid: "oid-1",
      tid: TID,
      roles: ["internal-org-admin"],
      authMethod: "entra",
      signedInAt: NOW,
    });
  });

  it("defaults a roleless Entra user to internal-viewer", async () => {
    const cfg = await load(ENTRA);
    const token = await cfg.callbacks.jwt({
      token: {},
      account: entraAccount,
      profile: entraProfile({ roles: undefined }),
    });
    expect(token?.roles).toEqual(["internal-viewer"]);
  });

  it("ignores internal-team-admin in the token", async () => {
    const cfg = await load(ENTRA);
    const token = await cfg.callbacks.jwt({
      token: {},
      account: entraAccount,
      profile: entraProfile({ roles: ["internal-team-admin"] }),
    });
    expect(token?.roles).toEqual(["internal-viewer"]);
  });

  it("honours the legacy Admin role in dev but not with APP_ENV=prod", async () => {
    let cfg = await load(ENTRA);
    let token = await cfg.callbacks.jwt({
      token: {},
      account: entraAccount,
      profile: entraProfile({ roles: ["Admin"] }),
    });
    expect(token?.roles).toEqual(["internal-admin"]);
    cfg = await load({ ...ENTRA, NODE_ENV: "production", APP_ENV: "prod" });
    token = await cfg.callbacks.jwt({
      token: {},
      account: entraAccount,
      profile: entraProfile({ roles: ["Admin"] }),
    });
    expect(token?.roles).toEqual(["internal-viewer"]);
  });

  const aged = (roles: string[], authMethod: string, ageSeconds: number) => ({
    oid: "o",
    tid: "t",
    roles,
    authMethod,
    signedInAt: NOW - ageSeconds,
  });

  it("rejects an admin token older than 4 hours, keeps one at 3 hours", async () => {
    const cfg = await load(ENTRA);
    expect(
      await cfg.callbacks.jwt({
        token: aged(["internal-admin"], "entra", 5 * H),
      }),
    ).toBeNull();
    expect(
      await cfg.callbacks.jwt({
        token: aged(["internal-admin"], "entra", 3 * H),
      }),
    ).not.toBeNull();
  });

  it("rejects a master token older than 1 hour", async () => {
    const cfg = await load(ENTRA);
    expect(
      await cfg.callbacks.jwt({
        token: aged(["internal-admin"], "master", 2 * H),
      }),
    ).toBeNull();
  });

  it("keeps a viewer token for up to 8 hours", async () => {
    const cfg = await load(ENTRA);
    expect(
      await cfg.callbacks.jwt({
        token: aged(["internal-viewer"], "entra", 7 * H),
      }),
    ).not.toBeNull();
    expect(
      await cfg.callbacks.jwt({
        token: aged(["internal-viewer"], "entra", 9 * H),
      }),
    ).toBeNull();
  });

  it("builds the token from the authorize() identity for credentials sign-ins", async () => {
    const cfg = await load({ AUTH_DEV_LOGIN: "true" });
    const token = await cfg.callbacks.jwt({
      token: {},
      account: { provider: "dev-login" },
      user: {
        oid: "local:dev@localhost",
        tid: "local",
        roles: ["internal-auditor"],
        authMethod: "local",
      },
    });
    expect(token).toMatchObject({
      oid: "local:dev@localhost",
      tid: "local",
      roles: ["internal-auditor"],
      authMethod: "local",
      signedInAt: NOW,
    });
  });
});

describe("session callback", () => {
  it("exposes oid, tid, roles, authMethod, name and email", async () => {
    const cfg = await load(ENTRA);
    const out = cfg.callbacks.session({
      session: {
        user: { name: "Ada", email: "ada@example.com" },
        expires: "x",
      },
      token: {
        oid: "oid-1",
        tid: TID,
        roles: ["internal-auditor"],
        authMethod: "entra",
      },
    });
    expect(out.user).toMatchObject({
      oid: "oid-1",
      tid: TID,
      roles: ["internal-auditor"],
      authMethod: "entra",
      name: "Ada",
      email: "ada@example.com",
    });
  });
});
