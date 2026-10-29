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
  entraIssuer: "https://login.microsoftonline.com/tenant/v2.0",
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
