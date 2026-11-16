import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SignInPage from "./page";

// Source: slice B1 brief B1-13 (the public sign-in page sits on the Slice A
// primitives: an auth card on Panel and tokens; every existing accessible name,
// form field and behaviour is unchanged) and Design System - Component
// Inventory, `Panel`. Observable only: the page h1 keeps its name and the
// provider controls render inside one card-surface region. The form fields and
// button names themselves stay covered in components/auth/SignInOptions.test.tsx.
vi.mock("@/auth", () => ({
  enabledSignInProviders: { entra: true, devLogin: true, master: true },
  signInWithEntra: vi.fn(async () => {}),
  signInWithDevLogin: vi.fn(async () => null),
  signInWithMasterUser: vi.fn(async () => {}),
}));

describe("SignInPage", () => {
  it("keeps the LLM Usage Lens h1 and every provider control", () => {
    render(<SignInPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "LLM Usage Lens" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in with microsoft/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in as local developer/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Authenticator code")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in as master user" }),
    ).toBeInTheDocument();
  });

  it("holds the sign-in controls in a Panel card region", () => {
    const { container } = render(<SignInPage />);

    const card = container.querySelector('[data-slot="card"]');
    if (!(card instanceof HTMLElement)) throw new Error("no auth card");
    expect(card).toHaveAccessibleName();
    expect(
      within(card).getByRole("button", { name: /sign in with microsoft/i }),
    ).toBeInTheDocument();
    expect(within(card).getByLabelText("Password")).toBeInTheDocument();
  });
});
