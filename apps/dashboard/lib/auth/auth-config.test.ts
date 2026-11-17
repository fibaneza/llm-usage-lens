import { describe, expect, it } from "vitest";

import {
  AuthConfigError,
  DEV_LOGIN_PROVIDER_ID,
  resolveAccessMode,
  resolveRuntimeAccessMode,
  resolveSignInProviders,
  type AuthEnvInput,
} from "./auth-config";

const ENTRA = {
  entraId: "client-id",
  entraSecret: "client-secret",
  entraIssuer:
    "https://login.microsoftonline.com/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/v2.0",
};

const resolve = (input: Partial<AuthEnvInput>) =>
  resolveSignInProviders({ nodeEnv: "development", appEnv: "dev", ...input });

describe("DEV_LOGIN_PROVIDER_ID", () => {
  it('is "dev-login"', () => {
    expect(DEV_LOGIN_PROVIDER_ID).toBe("dev-login");
  });
});

describe("resolveSignInProviders", () => {
  describe("enabled providers", () => {
    it("enables only Entra when fully configured", () => {
      expect(resolve(ENTRA)).toMatchObject({ entra: true, devLogin: false });
    });

    it("enables only the dev login outside production with AUTH_DEV_LOGIN=true", () => {
      expect(resolve({ devLogin: "true" })).toMatchObject({
        entra: false,
        devLogin: true,
      });
    });

    // Amended for Phase 4R.1 (Access Control spec, T7): the dev login is
    // rejected, not enabled, when Entra is configured.
    it("rejects the dev login when Entra is configured", () => {
      expect(() => resolve({ ...ENTRA, devLogin: "true" })).toThrow(
        AuthConfigError,
      );
    });

    it("enables the dev login under the test environment", () => {
      expect(resolve({ nodeEnv: "test", devLogin: "true" })).toMatchObject({
        entra: false,
        devLogin: true,
      });
    });

    it("enables the dev login when NODE_ENV is undefined", () => {
      expect(resolve({ nodeEnv: undefined, devLogin: "true" })).toMatchObject({
        entra: false,
        devLogin: true,
      });
    });

    it.each(["TRUE", "1", "yes", "false", "True"])(
      "does not enable the dev login for %j (exact 'true' only)",
      (value) => {
        // A production provider (the master user) is present so the call
        // resolves; only the exact string 'true' ever enables the dev login.
        expect(
          resolve({
            masterUsername: "root",
            masterPasswordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFz",
            devLogin: value,
          }),
        ).toMatchObject({ entra: false, devLogin: false });
      },
    );

    it("treats an empty-string dev login as unset", () => {
      expect(resolve({ ...ENTRA, devLogin: "" })).toMatchObject({
        entra: true,
        devLogin: false,
      });
    });
  });

  describe("no provider (fail closed, any environment)", () => {
    it.each(["development", "test", "production", undefined])(
      "throws AuthConfigError when nothing is configured (NODE_ENV=%s)",
      (nodeEnv) => {
        expect(() =>
          resolveSignInProviders({ nodeEnv, appEnv: "dev" }),
        ).toThrow(AuthConfigError);
      },
    );

    it("throws when the dev login value is not exactly 'true' and Entra is absent", () => {
      expect(() => resolve({ devLogin: "1" })).toThrow(AuthConfigError);
      expect(() => resolve({ devLogin: "TRUE" })).toThrow(AuthConfigError);
    });

    it("treats empty strings as unset for every variable", () => {
      expect(() =>
        resolve({
          entraId: "",
          entraSecret: "",
          entraIssuer: "",
          devLogin: "",
        }),
      ).toThrow(AuthConfigError);
    });
  });

  describe("partial Entra configuration", () => {
    it.each([
      ["only id", { entraId: ENTRA.entraId }],
      ["only secret", { entraSecret: ENTRA.entraSecret }],
      ["only issuer", { entraIssuer: ENTRA.entraIssuer }],
      [
        "id and secret",
        { entraId: ENTRA.entraId, entraSecret: ENTRA.entraSecret },
      ],
      [
        "secret and issuer",
        { entraSecret: ENTRA.entraSecret, entraIssuer: ENTRA.entraIssuer },
      ],
    ])("throws in development with %s", (_label, partial) => {
      expect(() => resolve({ ...partial, devLogin: "true" })).toThrow(
        AuthConfigError,
      );
    });

    it("throws in production too", () => {
      expect(() =>
        resolve({ nodeEnv: "production", entraId: ENTRA.entraId }),
      ).toThrow(AuthConfigError);
    });

    it("counts an empty-string var as unset (so two set + one empty is partial)", () => {
      expect(() =>
        resolve({ ...ENTRA, entraIssuer: "", devLogin: "true" }),
      ).toThrow(AuthConfigError);
    });
  });

  describe("production", () => {
    const production = { nodeEnv: "production" };

    it("enables only Entra when fully configured", () => {
      expect(resolve({ ...production, ...ENTRA })).toMatchObject({
        entra: true,
        devLogin: false,
      });
    });

    it("throws without Entra", () => {
      expect(() => resolve(production)).toThrow(AuthConfigError);
    });

    it.each(["true", "false", "1", "anything"])(
      "throws when AUTH_DEV_LOGIN=%j even with Entra configured",
      (devLogin) => {
        expect(() => resolve({ ...production, ...ENTRA, devLogin })).toThrow(
          AuthConfigError,
        );
      },
    );

    it("does not throw for an empty-string AUTH_DEV_LOGIN", () => {
      expect(resolve({ ...production, ...ENTRA, devLogin: "" })).toMatchObject({
        entra: true,
        devLogin: false,
      });
    });

    it("throws when the dev login is the only provider requested", () => {
      expect(() => resolve({ ...production, devLogin: "true" })).toThrow(
        AuthConfigError,
      );
    });
  });

  // Source: docs/specs/2026-05-15-system-architecture.md — "Authentication &
  // Access" → "Sign-in providers": the issuer must be tenant-specific
  // (`https://login.microsoftonline.com/<tenant GUID>/v2.0`, lowercase as Entra
  // publishes it) and `auth.ts` repeats the issuer check at runtime with the
  // other provider checks, so a skipped env validation (`SKIP_ENV_VALIDATION`)
  // can never enable Entra with the multi-tenant `common`, `organizations` or
  // `consumers` issuer. Same rule as `env.ts` (see env.test.ts).
  describe("Entra issuer (runtime repeat of the env.ts check)", () => {
    const TENANT = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
    const issuerFor = (tenant: string) =>
      `https://login.microsoftonline.com/${tenant}/v2.0`;
    const withIssuer = (
      entraIssuer: string,
      extra: Partial<AuthEnvInput> = {},
    ) => resolve({ ...ENTRA, entraIssuer, ...extra });

    describe.each(["development", "production"])("in %s", (nodeEnv) => {
      it.each([
        ["a lowercase tenant GUID", issuerFor(TENANT)],
        [
          "the CI build placeholder (nil GUID)",
          issuerFor("00000000-0000-0000-0000-000000000000"),
        ],
      ])("enables Entra with %s", (_n, issuer) => {
        expect(withIssuer(issuer, { nodeEnv })).toMatchObject({ entra: true });
      });

      it.each([
        ["common", issuerFor("common")],
        ["organizations", issuerFor("organizations")],
        ["consumers", issuerFor("consumers")],
        ["Common (mixed case)", issuerFor("Common")],
        ["an uppercase tenant GUID", issuerFor(TENANT.toUpperCase())],
        [
          "a tenant GUID with one hex letter uppercased",
          issuerFor(TENANT.replace(/[a-f]/, (c) => c.toUpperCase())),
        ],
        ["a word that is not a GUID", issuerFor("tenant")],
        ["a tenant domain name", issuerFor("contoso.onmicrosoft.com")],
        ["another host", `https://evil.example.com/${TENANT}/v2.0`],
        [
          "a host that merely starts with login.microsoftonline.com",
          `https://login.microsoftonline.com.evil.example.com/${TENANT}/v2.0`,
        ],
        [
          "a plain-http scheme",
          `http://login.microsoftonline.com/${TENANT}/v2.0`,
        ],
        ["no version segment", `https://login.microsoftonline.com/${TENANT}`],
        [
          "a trailing slash after /v2.0",
          `https://login.microsoftonline.com/${TENANT}/v2.0/`,
        ],
        [
          "a query string after /v2.0",
          `https://login.microsoftonline.com/${TENANT}/v2.0?tenant=common`,
        ],
      ])("throws AuthConfigError for %s", (_n, issuer) => {
        expect(() => withIssuer(issuer, { nodeEnv })).toThrow(AuthConfigError);
      });
    });

    it("does not fall back to the dev login when the issuer is rejected", () => {
      expect(() =>
        withIssuer(issuerFor("common"), { devLogin: "true" }),
      ).toThrow(AuthConfigError);
    });

    it("still enables the dev login alone when no Entra variable is set", () => {
      expect(resolve({ devLogin: "true" })).toMatchObject({
        entra: false,
        devLogin: true,
      });
    });

    it("names the variable and never echoes the rejected value", () => {
      const rejected = issuerFor(TENANT.toUpperCase());
      let message = "";
      try {
        withIssuer(rejected);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("AUTH_MICROSOFT_ENTRA_ID_ISSUER");
      expect(message).not.toContain(TENANT.toUpperCase());
    });
  });

  describe("AuthConfigError", () => {
    it("is a named Error subclass with a message", () => {
      let caught: unknown;
      try {
        resolve({});
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).toBeInstanceOf(AuthConfigError);
      expect((caught as Error).name).toBe("AuthConfigError");
      expect((caught as Error).message).not.toBe("");
    });

    it("never echoes the Entra secret in its message", () => {
      let message = "";
      try {
        resolve({ entraSecret: "super-secret-value" });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toContain("super-secret-value");
    });
  });
});

describe("access mode and sign-in rules (Access Control spec - Environment, Sign-in methods; T7, T21)", () => {
  // Source: docs/specs/2026-11-10-access-control.md — Environment; Sign-in
  // methods; Threat model T7 (no dev login beside Entra) and T21 (APP_ENV
  // required; open never in prod; prod needs Entra and TOTP for the master
  // user). Contract R1 decisions 6-8. AuthEnvInput gains `appEnv`,
  // `masterUsername`, `masterPasswordHash`, `masterTotpSecret`; the result gains
  // `master: boolean`.
  const ENTRA = {
    entraId: "client-id",
    entraSecret: "client-secret",
    entraIssuer:
      "https://login.microsoftonline.com/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/v2.0",
  };
  const MASTER = {
    masterUsername: "root",
    masterPasswordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
  };

  const resolve = (input: Partial<AuthEnvInput>) =>
    resolveSignInProviders({
      nodeEnv: "development",
      appEnv: "dev",
      ...input,
    } as AuthEnvInput);

  describe("resolveAccessMode", () => {
    it("returns open and enforce as given in dev", () => {
      expect(resolveAccessMode("open", "dev")).toBe("open");
      expect(resolveAccessMode("enforce", "dev")).toBe("enforce");
    });
    it.each([undefined, "", "nope", "OPEN "])(
      "falls back to enforce for %j",
      (raw) => {
        expect(resolveAccessMode(raw, "dev")).toBe("enforce");
        expect(resolveAccessMode(raw, "prod")).toBe("enforce");
      },
    );
    it("rejects open in prod with a message that names the variable", () => {
      expect(() => resolveAccessMode("open", "prod")).toThrow(AuthConfigError);
      expect(() => resolveAccessMode("open", "prod")).toThrow(
        /AUTH_ACCESS_MODE/,
      );
    });
  });

  describe("resolveSignInProviders (R1 rules)", () => {
    it("T7: rejects the dev login when Entra is configured", () => {
      expect(() => resolve({ ...ENTRA, devLogin: "true" })).toThrow(
        AuthConfigError,
      );
      expect(() => resolve({ ...ENTRA, devLogin: "true" })).toThrow(
        /AUTH_DEV_LOGIN/,
      );
    });

    // Access Control T7 / LiteLLM LT21, Rule 50: APP_ENV=prod rejects the dev
    // login even when NODE_ENV is not "production" (the two flags are independent).
    it("T7: APP_ENV=prod rejects AUTH_DEV_LOGIN when NODE_ENV is development", () => {
      const prodWithMaster = {
        appEnv: "prod",
        nodeEnv: "development",
        ...MASTER,
        masterTotpSecret: "JBSWY3DPEHPK3PXP",
        devLogin: "true",
      };
      expect(() => resolve(prodWithMaster)).toThrow(AuthConfigError);
      expect(() => resolve(prodWithMaster)).toThrow(/AUTH_DEV_LOGIN/);
    });

    it("T21: requires APP_ENV", () => {
      expect(() => resolve({ appEnv: undefined, devLogin: "true" })).toThrow(
        AuthConfigError,
      );
      expect(() =>
        resolve({ appEnv: "staging" as never, devLogin: "true" }),
      ).toThrow(AuthConfigError);
    });

    // Access Control spec — Pre-SSO mode (D19): prod without Entra is valid
    // only with the master user and TOTP.
    it("T21: APP_ENV=prod without Entra needs the master user with TOTP", () => {
      expect(
        resolve({
          appEnv: "prod",
          nodeEnv: "production",
          ...MASTER,
          masterTotpSecret: "JBSWY3DPEHPK3PXP",
        }),
      ).toMatchObject({ entra: false, master: true, devLogin: false });
      expect(() => resolve({ appEnv: "prod", nodeEnv: "production" })).toThrow(
        AuthConfigError,
      );
      expect(() =>
        resolve({ appEnv: "prod", nodeEnv: "production", ...MASTER }),
      ).toThrow(AuthConfigError);
    });

    it("T21: prod with the master user requires a TOTP secret", () => {
      expect(() =>
        resolve({ appEnv: "prod", nodeEnv: "production", ...ENTRA, ...MASTER }),
      ).toThrow(/AUTH_MASTER_TOTP_SECRET/);
      expect(
        resolve({
          appEnv: "prod",
          nodeEnv: "production",
          ...ENTRA,
          ...MASTER,
          masterTotpSecret: "JBSWY3DPEHPK3PXP",
        }),
      ).toMatchObject({ entra: true, master: true, devLogin: false });
    });

    it("master username and hash must be set together", () => {
      expect(() => resolve({ ...ENTRA, masterUsername: "root" })).toThrow(
        AuthConfigError,
      );
      expect(() =>
        resolve({ ...ENTRA, masterPasswordHash: MASTER.masterPasswordHash }),
      ).toThrow(AuthConfigError);
    });

    it("rejects a master hash that is not argon2id", () => {
      expect(() =>
        resolve({ ...ENTRA, ...MASTER, masterPasswordHash: "plaintext" }),
      ).toThrow(AuthConfigError);
    });

    it("master provider is off when unset, on when configured", () => {
      expect(resolve({ ...ENTRA })).toMatchObject({ master: false });
      expect(resolve({ ...ENTRA, ...MASTER })).toMatchObject({ master: true });
    });

    it("NODE_ENV=production accepts the master user alone as the production provider", () => {
      expect(
        resolve({ nodeEnv: "production", appEnv: "dev", ...MASTER }),
      ).toMatchObject({ entra: false, master: true, devLogin: false });
    });

    it("NODE_ENV=production still rejects AUTH_DEV_LOGIN", () => {
      expect(() =>
        resolve({ nodeEnv: "production", devLogin: "true", ...MASTER }),
      ).toThrow(/AUTH_DEV_LOGIN/);
    });

    it("dev login alone works in dev; error messages never contain values", () => {
      expect(resolve({ devLogin: "true" })).toMatchObject({
        devLogin: true,
        entra: false,
      });
      try {
        resolve({ appEnv: "prod", nodeEnv: "production", ...ENTRA, ...MASTER });
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toContain(MASTER.masterPasswordHash);
        expect(msg).not.toContain(ENTRA.entraSecret);
      }
    });
  });
});

// Source: docs/specs/2026-11-10-access-control.md — Rollout / Environment:
// unset or invalid -> enforce; `open` never when APP_ENV=prod. Contract R2 §3
// `resolveRuntimeAccessMode` and §6 carry-in (throws for open + prod at
// runtime). The build phase runs with placeholder env, so it must not throw.
describe("resolveRuntimeAccessMode", () => {
  it("returns open for open in dev at runtime", () => {
    expect(
      resolveRuntimeAccessMode({
        isBuildPhase: false,
        raw: "open",
        appEnv: "dev",
      }),
    ).toBe("open");
  });

  it("throws for open in prod at runtime", () => {
    expect(() =>
      resolveRuntimeAccessMode({
        isBuildPhase: false,
        raw: "open",
        appEnv: "prod",
      }),
    ).toThrow(AuthConfigError);
  });

  it.each([undefined, "", "enforce", "bogus"])(
    "returns enforce for raw=%j",
    (raw) => {
      expect(
        resolveRuntimeAccessMode({ isBuildPhase: false, raw, appEnv: "prod" }),
      ).toBe("enforce");
    },
  );

  it("does not throw during the build phase", () => {
    expect(() =>
      resolveRuntimeAccessMode({
        isBuildPhase: true,
        raw: "open",
        appEnv: "prod",
      }),
    ).not.toThrow();
  });
});
