import { trace, type Span } from "@opentelemetry/api";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SignInPage from "./page";

// Source: slice B1 brief B1-13 (the public sign-in page sits on the Slice A
// primitives: an auth card on Panel and tokens; every existing accessible name,
// form field and behaviour is unchanged) and Design System - Component
// Inventory, `Panel`. Unit SI1: Design System - Sign-in page, "The forms
// (unit SI1)" (T-SI2, T-SI4, T-SI5), Access Control - Password users D24 and
// threats T20, T23. The form fields and button names themselves stay covered in
// components/auth/SignInOptions.test.tsx.
// The real next-auth cannot load under jsdom, so the error classes are
// stand-ins with the same subclass relation.
const mocks = vi.hoisted(() => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {}
  return {
    AuthError,
    CredentialsSignin,
    signInWithPassword: vi.fn(async () => {}),
    signInWithMasterUser: vi.fn<(formData: FormData) => Promise<void>>(
      async () => {},
    ),
    getPasswordSignIn: vi.fn(),
    props: undefined as Record<string, unknown> | undefined,
  };
});
const { AuthError, CredentialsSignin } = mocks;
vi.mock("next-auth", () => ({
  AuthError: mocks.AuthError,
  CredentialsSignin: mocks.CredentialsSignin,
}));
vi.mock("@/auth", () => ({
  enabledSignInProviders: { entra: true, devLogin: true, master: true },
  signInWithEntra: vi.fn(async () => {}),
  signInWithDevLogin: vi.fn(async () => null),
  signInWithMasterUser: mocks.signInWithMasterUser,
  signInWithPassword: mocks.signInWithPassword,
}));
vi.mock("@/lib/data/access/password-users", () => ({
  getPasswordSignIn: mocks.getPasswordSignIn,
}));
vi.mock("@/components/auth/SignInOptions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/auth/SignInOptions")>();
  return {
    SignInOptions: (props: Record<string, unknown>) => {
      mocks.props = props;
      return createElement(
        actual.SignInOptions as (p: Record<string, unknown>) => never,
        props,
      );
    },
  };
});

type FormAction = (formData: FormData) => Promise<{ ok: false } | void>;
const masterAction = () => mocks.props?.masterAction as FormAction;

async function renderPage() {
  return render(await SignInPage());
}

beforeEach(() => {
  mocks.signInWithPassword.mockClear();
  mocks.signInWithMasterUser.mockReset();
  mocks.signInWithMasterUser.mockResolvedValue(undefined);
  mocks.getPasswordSignIn.mockReset();
  mocks.getPasswordSignIn.mockResolvedValue({ enabled: true, version: 1 });
  mocks.props = undefined;
});

describe("SignInPage", () => {
  it("keeps the LLM Usage Lens h1 and every provider control", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "LLM Usage Lens" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in with microsoft/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in as local developer/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in as master user" }),
    ).toBeInTheDocument();
  });

  // T-SI2: the master form is not on the page until the disclosure is chosen.
  it("shows the master user's Username field only after 'Sign in as master user' (T-SI2)", async () => {
    await renderPage();
    expect(screen.queryByLabelText("Username")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Sign in as master user" }),
    );
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
  });

  it("holds the sign-in controls in a Panel card region", async () => {
    const { container } = await renderPage();

    const card = container.querySelector('[data-slot="card"]');
    if (!(card instanceof HTMLElement)) throw new Error("no auth card");
    expect(card).toHaveAccessibleName();
    expect(
      within(card).getByRole("button", { name: /sign in with microsoft/i }),
    ).toBeInTheDocument();
    expect(within(card).getByLabelText("Email")).toBeInTheDocument();
  });
});

describe("SignInPage password group (D24, T-SI5)", () => {
  it("passes the password action while password sign-in is on (T-SI3, T-SI5)", async () => {
    await renderPage();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(mocks.props?.password).toBe(true);
    expect(mocks.props?.passwordAction).toBe(mocks.signInWithPassword);
  });

  it("omits the email and password group while password sign-in is off (D24, T-SI5)", async () => {
    mocks.getPasswordSignIn.mockResolvedValue({ enabled: false, version: 2 });
    await renderPage();

    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(mocks.props?.password).toBeFalsy();
    expect(
      screen.getByRole("button", { name: /sign in with microsoft/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in as master user" }),
    ).toBeInTheDocument();
  });

  it("reads the switch on every request, never from a cache (D24, T-SI5)", async () => {
    const first = await renderPage();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();

    mocks.getPasswordSignIn.mockResolvedValue({ enabled: false, version: 2 });
    first.unmount();
    await renderPage();

    expect(mocks.getPasswordSignIn).toHaveBeenCalledTimes(2);
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("fails closed when the read throws: no group, the error recorded, the other methods still render (D24, T-SI5)", async () => {
    const failure = new Error("dynamodb unavailable");
    mocks.getPasswordSignIn.mockRejectedValue(failure);
    const recordException = vi.fn();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue({
      recordException,
    } as unknown as Span);

    await renderPage();

    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(mocks.props?.password).toBeFalsy();
    expect(recordException).toHaveBeenCalledWith(failure);
    expect(
      screen.getByRole("button", { name: /sign in with microsoft/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in as local developer/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in as master user" }),
    ).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

// T-SI4: the master user gets the same one generic state as a password user.
describe("SignInPage master wrapper (T-SI4, T20, T23)", () => {
  it.each([
    ["CredentialsSignin", () => new CredentialsSignin()],
    ["another AuthError subclass", () => new AuthError("config")],
  ])(
    "returns { ok: false } when signInWithMasterUser throws %s",
    async (_n, make) => {
      await renderPage();
      mocks.signInWithMasterUser.mockRejectedValue(make());
      const data = new FormData();
      data.set("username", "master");
      data.set("password", "secret-pw");
      const result = await masterAction()(data);
      expect(result).toStrictEqual({ ok: false });
      expect(JSON.stringify(result)).not.toContain("secret-pw");
      expect(mocks.signInWithMasterUser).toHaveBeenCalledWith(data);
    },
  );

  it("returns nothing on success and rethrows a non-AuthError such as the redirect", async () => {
    await renderPage();
    expect(await masterAction()(new FormData())).toBeUndefined();

    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/dashboard;307;",
    });
    mocks.signInWithMasterUser.mockRejectedValue(redirect);
    await expect(masterAction()(new FormData())).rejects.toBe(redirect);
  });
});
