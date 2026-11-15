import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t3-env only validates server vars when `window` is undefined, hence the node
// environment. Rules: docs/guides/auth-setup.md; Rule 50.2. The fixture issuer
// names a tenant GUID: env validation rejects any other issuer (System
// Architecture — "Sign-in providers").
const ENTRA = {
  AUTH_MICROSOFT_ENTRA_ID_ID: "client-id",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "client-secret",
  AUTH_MICROSOFT_ENTRA_ID_ISSUER:
    "https://login.microsoftonline.com/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/v2.0",
};

function stubBase(overrides: Record<string, string>) {
  const vars: Record<string, string> = {
    SKIP_ENV_VALIDATION: "",
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

  // User decision 2026-11-15 (Rule 60.19): AUTH_SECRET is required; the cursor
  // key has no random fallback, so startup fails without it.
  it("throws when AUTH_SECRET is missing", async () => {
    stubBase({ NODE_ENV: "development", AUTH_DEV_LOGIN: "true" });
    vi.stubEnv("AUTH_SECRET", "");
    await expect(loadEnv()).rejects.toThrow(/AUTH_SECRET/);
  });

  it("passes in development with AUTH_DEV_LOGIN=true", async () => {
    stubBase({ NODE_ENV: "development", AUTH_DEV_LOGIN: "true" });
    const { env } = await loadEnv();
    expect(env.AUTH_DEV_LOGIN).toBe("true");
  });

  it("passes in development with the .env.example values", async () => {
    const template = parseEnv(
      readFileSync(join(import.meta.dirname, ".env.example"), "utf8"),
    );
    stubBase({ NODE_ENV: "development", ...template });
    const { env } = await loadEnv();
    expect(env.AUTH_DEV_LOGIN).toBe("true");
    expect(env.AUTH_MICROSOFT_ENTRA_ID_ID).toBeUndefined();
  });

  it("throws in a production build with the .env.example AUTH_SECRET", async () => {
    stubBase({
      NODE_ENV: "production",
      AUTH_SECRET: "local-dev-placeholder",
      ...ENTRA,
    });
    await expect(loadEnv()).rejects.toThrow();
  });

  it("throws with APP_ENV=prod and the .env.example AUTH_SECRET", async () => {
    stubBase({
      NODE_ENV: "development",
      APP_ENV: "prod",
      AUTH_SECRET: "local-dev-placeholder",
      ...ENTRA,
    });
    await expect(loadEnv()).rejects.toThrow();
  });

  it("passes in production with full Entra", async () => {
    stubBase({ NODE_ENV: "production", ...ENTRA });
    const { env } = await loadEnv();
    expect(env.AUTH_MICROSOFT_ENTRA_ID_ID).toBe("client-id");
  });
});

// ---------------------------------------------------------------------------
// Tenant-specific Entra issuer. Source: docs/specs/2026-05-15-system-architecture.md
// — "Authentication & Access" → "Sign-in providers": the issuer must be
// `https://login.microsoftonline.com/<tenant GUID>/v2.0`, lowercase as Entra
// publishes it (Auth.js compares the issuer exactly); the multi-tenant
// `common`, `organizations` and `consumers` issuers fail env validation,
// because an app role grants writes. docs/guides/auth-setup.md — "The issuer
// must name your tenant ID as a lowercase GUID". implementation-phases —
// Phase 3.3 amendment, "Hardening". Rule 50.2.
// ---------------------------------------------------------------------------

const TENANT = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const CI_PLACEHOLDER_ISSUER =
  "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0";

const withIssuer = (issuer: string, nodeEnv = "development") => ({
  NODE_ENV: nodeEnv,
  ...ENTRA,
  AUTH_MICROSOFT_ENTRA_ID_ISSUER: issuer,
});

describe("env.ts requires a tenant-specific Entra issuer", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("accepts", () => {
    it.each([
      ["a tenant GUID", `https://login.microsoftonline.com/${TENANT}/v2.0`],
      ["the CI build placeholder (nil GUID)", CI_PLACEHOLDER_ISSUER],
    ])("%s", async (_n, issuer) => {
      stubBase(withIssuer(issuer));
      const { env } = await loadEnv();
      expect(env.AUTH_MICROSOFT_ENTRA_ID_ISSUER).toBe(issuer);
    });

    it("accepts a tenant GUID in production", async () => {
      const issuer = `https://login.microsoftonline.com/${TENANT}/v2.0`;
      stubBase(withIssuer(issuer, "production"));
      const { env } = await loadEnv();
      expect(env.AUTH_MICROSOFT_ENTRA_ID_ISSUER).toBe(issuer);
    });

    it("accepts the placeholder that root package.json build:ci passes to the build", async () => {
      const manifest: unknown = JSON.parse(
        readFileSync(join(__dirname, "../../package.json"), "utf8"),
      );
      const buildCi =
        typeof manifest === "object" &&
        manifest !== null &&
        "scripts" in manifest &&
        typeof manifest.scripts === "object" &&
        manifest.scripts !== null &&
        "build:ci" in manifest.scripts
          ? manifest.scripts["build:ci"]
          : undefined;
      const issuer =
        typeof buildCi === "string"
          ? /AUTH_MICROSOFT_ENTRA_ID_ISSUER=(\S+)/.exec(buildCi)?.[1]
          : undefined;
      expect(issuer).toBe(CI_PLACEHOLDER_ISSUER);

      stubBase(withIssuer(issuer ?? "", "production"));
      const { env } = await loadEnv();
      expect(env.AUTH_MICROSOFT_ENTRA_ID_ISSUER).toBe(CI_PLACEHOLDER_ISSUER);
    });
  });

  describe("rejects", () => {
    it.each([
      ["common", `https://login.microsoftonline.com/common/v2.0`],
      ["organizations", `https://login.microsoftonline.com/organizations/v2.0`],
      ["consumers", `https://login.microsoftonline.com/consumers/v2.0`],
      ["Common (mixed case)", `https://login.microsoftonline.com/Common/v2.0`],
      ["COMMON", `https://login.microsoftonline.com/COMMON/v2.0`],
      [
        "Organizations (mixed case)",
        `https://login.microsoftonline.com/Organizations/v2.0`,
      ],
      [
        "Consumers (mixed case)",
        `https://login.microsoftonline.com/Consumers/v2.0`,
      ],
    ])("the multi-tenant %s issuer", async (_n, issuer) => {
      stubBase(withIssuer(issuer));
      await expect(loadEnv()).rejects.toThrow();
    });

    it.each(["common", "organizations", "consumers"])(
      "the multi-tenant %s issuer in production",
      async (tenant) => {
        stubBase(
          withIssuer(
            `https://login.microsoftonline.com/${tenant}/v2.0`,
            "production",
          ),
        );
        await expect(loadEnv()).rejects.toThrow();
      },
    );

    it.each([
      [
        "a word that is not a GUID",
        `https://login.microsoftonline.com/tenant/v2.0`,
      ],
      [
        "a tenant domain name",
        `https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0`,
      ],
      [
        "a GUID that is too short",
        `https://login.microsoftonline.com/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6/v2.0`,
      ],
      [
        "a GUID with an extra segment",
        `https://login.microsoftonline.com/${TENANT}-1234/v2.0`,
      ],
      [
        "a GUID with non-hex characters",
        `https://login.microsoftonline.com/zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/v2.0`,
      ],
      [
        "a GUID without hyphens",
        `https://login.microsoftonline.com/${TENANT.replaceAll("-", "")}/v2.0`,
      ],
      [
        "a GUID in braces",
        `https://login.microsoftonline.com/{${TENANT}}/v2.0`,
      ],
      ["an empty tenant segment", `https://login.microsoftonline.com//v2.0`],
      [
        "a placeholder left in from the docs",
        `https://login.microsoftonline.com/<tenant id>/v2.0`,
      ],
    ])("a tenant that is %s", async (_n, issuer) => {
      stubBase(withIssuer(issuer));
      await expect(loadEnv()).rejects.toThrow();
    });

    it.each([
      ["another host", `https://evil.example.com/${TENANT}/v2.0`],
      [
        "a host that merely starts with login.microsoftonline.com",
        `https://login.microsoftonline.com.evil.example.com/${TENANT}/v2.0`,
      ],
      [
        "a host that embeds login.microsoftonline.com in its path",
        `https://evil.example.com/login.microsoftonline.com/${TENANT}/v2.0`,
      ],
      [
        "login.microsoftonline.com as userinfo in front of another host",
        `https://login.microsoftonline.com@evil.example.com/${TENANT}/v2.0`,
      ],
      ["the v1 sts.windows.net host", `https://sts.windows.net/${TENANT}/v2.0`],
      [
        "a plain-http scheme",
        `http://login.microsoftonline.com/${TENANT}/v2.0`,
      ],
    ])(
      "a host that is not login.microsoftonline.com over https: %s",
      async (_n, issuer) => {
        stubBase(withIssuer(issuer));
        await expect(loadEnv()).rejects.toThrow();
      },
    );

    it.each([
      ["no version segment", `https://login.microsoftonline.com/${TENANT}`],
      ["the v1.0 endpoint", `https://login.microsoftonline.com/${TENANT}/v1.0`],
      [
        "a trailing slash instead of /v2.0",
        `https://login.microsoftonline.com/${TENANT}/`,
      ],
      [
        "extra path after /v2.0",
        `https://login.microsoftonline.com/${TENANT}/v2.0/extra`,
      ],
      [
        "a query string after /v2.0",
        `https://login.microsoftonline.com/${TENANT}/v2.0?tenant=common`,
      ],
      [
        "a fragment after /v2.0",
        `https://login.microsoftonline.com/${TENANT}/v2.0#common`,
      ],
      [
        "an extra path segment before the tenant",
        `https://login.microsoftonline.com/common/${TENANT}/v2.0`,
      ],
    ])("an issuer with %s", async (_n, issuer) => {
      stubBase(withIssuer(issuer));
      await expect(loadEnv()).rejects.toThrow();
    });

    // The issuer is the lowercase GUID Entra publishes, with no trailing slash:
    // Auth.js compares it exactly, so a differently written value would pass
    // validation and then fail every sign-in. Each case is otherwise a valid
    // configuration, so only the case or the slash can be the reason.
    describe.each(["development", "production"])(
      "in %s, a canonical-looking issuer that is not exactly the published form",
      (nodeEnv) => {
        it.each([
          [
            "an uppercase tenant GUID",
            `https://login.microsoftonline.com/${TENANT.toUpperCase()}/v2.0`,
          ],
          [
            "a tenant GUID with its first hex letter uppercased",
            `https://login.microsoftonline.com/${TENANT.replace(/[a-f]/, (c) => c.toUpperCase())}/v2.0`,
          ],
          [
            "a tenant GUID with its last hex letter uppercased",
            `https://login.microsoftonline.com/${TENANT.replace(/[a-f](?=[^a-f]*$)/, (c) => c.toUpperCase())}/v2.0`,
          ],
          [
            "a trailing slash after /v2.0",
            `https://login.microsoftonline.com/${TENANT}/v2.0/`,
          ],
        ])("%s is rejected", async (_n, issuer) => {
          expect(issuer).not.toBe(
            `https://login.microsoftonline.com/${TENANT}/v2.0`,
          );
          stubBase(withIssuer(issuer, nodeEnv));
          await expect(loadEnv()).rejects.toThrow();
        });

        it("the same configuration with the exact published form is accepted", async () => {
          const issuer = `https://login.microsoftonline.com/${TENANT}/v2.0`;
          stubBase(withIssuer(issuer, nodeEnv));
          const { env } = await loadEnv();
          expect(env.AUTH_MICROSOFT_ENTRA_ID_ISSUER).toBe(issuer);
        });
      },
    );
  });

  it("still treats an unset issuer as unconfigured (the dev login can run alone)", async () => {
    stubBase({ NODE_ENV: "development", AUTH_DEV_LOGIN: "true" });
    const { env } = await loadEnv();
    expect(env.AUTH_MICROSOFT_ENTRA_ID_ISSUER).toBeUndefined();
  });
});

// Source: docs/specs/2026-11-10-platform.md — Data isolation, "Encryption key"
// row: the container gets TOTP_KMS_KEY_ID (the CMK) and prod requires it.
describe("env.ts TOTP_KMS_KEY_ID", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is required when APP_ENV=prod", async () => {
    stubBase({ NODE_ENV: "production", APP_ENV: "prod", ...ENTRA });
    await expect(loadEnv()).rejects.toThrow(/TOTP_KMS_KEY_ID/);
  });

  it("passes in prod when set", async () => {
    stubBase({
      NODE_ENV: "production",
      APP_ENV: "prod",
      TOTP_KMS_KEY_ID: "key-id-1",
      ...ENTRA,
    });
    await expect(loadEnv()).resolves.toBeDefined();
  });

  it("is optional when APP_ENV=dev", async () => {
    stubBase({ NODE_ENV: "production", ...ENTRA });
    await expect(loadEnv()).resolves.toBeDefined();
  });
});
