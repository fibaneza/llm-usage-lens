import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Source: Design System - Sign-in page, "The forms (unit SI1)" tests T-SI3 and
// T-SI4; Access Control - Password users (Sign-in) and threats T20, T23;
// Rule 60.15 (pre-auth sign-in action: Zod input, generic error, no session
// check). Auth.js is mocked like auth.test.ts: this file covers the wiring of
// the `signInWithPassword` server action, not the provider (see
// auth.sign-in-password.integration.test.ts and lib/auth/*).
// The real next-auth cannot load under jsdom, so the error classes are
// stand-ins with the same subclass relation.
const captured = vi.hoisted(() => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {}
  return {
    AuthError,
    CredentialsSignin,
    signIn: undefined as unknown as ReturnType<typeof vi.fn>,
  };
});
const { AuthError, CredentialsSignin } = captured;
vi.mock("next-auth", () => {
  return {
    AuthError: captured.AuthError,
    CredentialsSignin: captured.CredentialsSignin,
    default: () => {
      captured.signIn = vi.fn();
      return {
        handlers: {},
        auth: vi.fn(),
        signIn: captured.signIn,
        signOut: vi.fn(),
      };
    },
  };
});
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: unknown) => ({ type: "credentials", options }),
}));
vi.mock("next-auth/providers/microsoft-entra-id", () => ({
  default: { type: "oidc", id: "microsoft-entra-id" },
}));
vi.mock("@/lib/data/access/password-credentials-store", () => ({
  getPasswordCredential: vi.fn(),
}));

type PasswordAction = (formData: FormData) => Promise<{ ok: false } | void>;

async function loadAction(): Promise<PasswordAction> {
  vi.resetModules();
  vi.stubEnv("SKIP_ENV_VALIDATION", "1");
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("NEXT_PHASE", "");
  vi.stubEnv("APP_ENV", "dev");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AUTH_DEV_LOGIN", "true");
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_ID", "");
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_SECRET", "");
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_ISSUER", "");
  vi.stubGlobal("window", undefined);
  const mod = (await import("@/auth")) as unknown as Record<string, unknown>;
  const action = mod.signInWithPassword;
  if (typeof action !== "function") {
    throw new Error("auth.ts must export signInWithPassword");
  }
  return action as PasswordAction;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function sentPayload(): Record<string, string> {
  const call = captured.signIn.mock.calls[0] as
    | [string, Record<string, string>]
    | undefined;
  if (!call) throw new Error("signIn was not called");
  return call[1];
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("signInWithPassword", () => {
  it("passes email, password and code to the password provider and redirects to /dashboard (T-SI3)", async () => {
    const action = await loadAction();
    captured.signIn.mockResolvedValue(undefined);
    const result = await action(
      form({ email: "a@example.com", password: "pw-1", totp: "123456" }),
    );
    expect(result).toBeUndefined();
    expect(captured.signIn).toHaveBeenCalledWith("password", {
      email: "a@example.com",
      password: "pw-1",
      totp: "123456",
      redirectTo: "/dashboard",
    });
  });

  it("sends an empty code as an empty string (T-SI3, code optional)", async () => {
    const action = await loadAction();
    captured.signIn.mockResolvedValue(undefined);
    await action(form({ email: "a@example.com", password: "pw-1" }));
    expect(sentPayload().totp).toBe("");
  });

  it.each([
    ["CredentialsSignin", () => new CredentialsSignin()],
    ["another AuthError subclass", () => new AuthError("config problem")],
  ])(
    "returns exactly { ok: false } on %s and no credential (T-SI4, T20, T23)",
    async (_name, make) => {
      const action = await loadAction();
      captured.signIn.mockRejectedValue(make());
      const result = await action(
        form({ email: "a@example.com", password: "secret-pw", totp: "654321" }),
      );
      expect(result).toStrictEqual({ ok: false });
      expect(JSON.stringify(result)).not.toContain("secret-pw");
      expect(JSON.stringify(result)).not.toContain("a@example.com");
    },
  );

  // T23: no early, faster refusal - every attempt reaches the provider, with a
  // bad field coerced to "".
  it("calls the provider with an empty string for a missing field (T23)", async () => {
    const action = await loadAction();
    captured.signIn.mockRejectedValue(new CredentialsSignin());
    expect(await action(form({ email: "a@example.com" }))).toStrictEqual({
      ok: false,
    });
    expect(captured.signIn).toHaveBeenCalledTimes(1);
    expect(sentPayload()).toMatchObject({
      email: "a@example.com",
      password: "",
      totp: "",
    });
  });

  it("calls the provider with an empty string for a non-string (file) field (T23)", async () => {
    const action = await loadAction();
    captured.signIn.mockRejectedValue(new CredentialsSignin());
    const data = form({ email: "a@example.com", password: "pw-1" });
    data.set("totp", new Blob(["123456"]), "code.txt");
    await action(data);
    expect(captured.signIn).toHaveBeenCalledTimes(1);
    expect(sentPayload().totp).toBe("");
  });

  it("calls the provider with an empty string for an over-long field (T23)", async () => {
    const action = await loadAction();
    captured.signIn.mockRejectedValue(new CredentialsSignin());
    await action(
      form({
        email: "a@example.com",
        password: "p".repeat(257),
        totp: "1".repeat(300),
      }),
    );
    expect(captured.signIn).toHaveBeenCalledTimes(1);
    expect(sentPayload()).toMatchObject({
      email: "a@example.com",
      password: "",
      totp: "",
    });
  });

  it("rethrows a non-AuthError such as the Next redirect (T-SI3)", async () => {
    const action = await loadAction();
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/dashboard;307;",
    });
    captured.signIn.mockRejectedValue(redirect);
    await expect(
      action(form({ email: "a@example.com", password: "pw-1" })),
    ).rejects.toBe(redirect);
  });
});
