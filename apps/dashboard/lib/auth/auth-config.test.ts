import { describe, expect, it } from "vitest";

import {
  AuthConfigError,
  DEV_LOGIN_PROVIDER_ID,
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
  resolveSignInProviders({ nodeEnv: "development", ...input });

describe("DEV_LOGIN_PROVIDER_ID", () => {
  it('is "dev-login"', () => {
    expect(DEV_LOGIN_PROVIDER_ID).toBe("dev-login");
  });
});

describe("resolveSignInProviders", () => {
  describe("enabled providers", () => {
    it("enables only Entra when fully configured", () => {
      expect(resolve(ENTRA)).toEqual({ entra: true, devLogin: false });
    });

    it("enables only the dev login outside production with AUTH_DEV_LOGIN=true", () => {
      expect(resolve({ devLogin: "true" })).toEqual({
        entra: false,
        devLogin: true,
      });
    });

    it("enables both when Entra is configured and the dev login is on", () => {
      expect(resolve({ ...ENTRA, devLogin: "true" })).toEqual({
        entra: true,
        devLogin: true,
      });
    });

    it("enables the dev login under the test environment", () => {
      expect(resolve({ nodeEnv: "test", devLogin: "true" })).toEqual({
        entra: false,
        devLogin: true,
      });
    });

    it("enables the dev login when NODE_ENV is undefined", () => {
      expect(resolve({ nodeEnv: undefined, devLogin: "true" })).toEqual({
        entra: false,
        devLogin: true,
      });
    });

    it.each(["TRUE", "1", "yes", "false", "True"])(
      "does not enable the dev login for %j (exact 'true' only)",
      (value) => {
        expect(resolve({ ...ENTRA, devLogin: value })).toEqual({
          entra: true,
          devLogin: false,
        });
      },
    );

    it("treats an empty-string dev login as unset", () => {
      expect(resolve({ ...ENTRA, devLogin: "" })).toEqual({
        entra: true,
        devLogin: false,
      });
    });
  });

  describe("no provider (fail closed, any environment)", () => {
    it.each(["development", "test", "production", undefined])(
      "throws AuthConfigError when nothing is configured (NODE_ENV=%s)",
      (nodeEnv) => {
        expect(() => resolveSignInProviders({ nodeEnv })).toThrow(
          AuthConfigError,
        );
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
      expect(resolve({ ...production, ...ENTRA })).toEqual({
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
      expect(resolve({ ...production, ...ENTRA, devLogin: "" })).toEqual({
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
      expect(resolve({ devLogin: "true" })).toEqual({
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
