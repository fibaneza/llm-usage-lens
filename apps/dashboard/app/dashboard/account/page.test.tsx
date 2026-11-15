import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Source: temp/run-r4b/decisions.md F9 (Account page at /dashboard/account: a
// password user gets the change-password form; other sign-in methods see their
// method and no form); Access Control spec - "Password users" (POST
// /api/account/password is for password sessions only: Entra, master and
// dev-login are refused), Rule 10.3 / 50.3 (identity resolved on the server).
// Module under test: `app/dashboard/account/page.tsx` (async Server
// Component, default export). It reads the session with auth(), and for a
// `password` session whether TOTP is enrolled from
// getPasswordCredential(email) (`totpCipher` present = enrolled), then renders
// <ChangePasswordForm totpEnrolled /> from components/account/.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));

const getPasswordCredential = vi.fn();
vi.mock("@/lib/data/access/password-credentials-store", () => ({
  getPasswordCredential: (email: string) => getPasswordCredential(email),
}));

const form = vi.fn((props: { totpEnrolled: boolean }) => (
  <form aria-label="Change password" data-totp={String(props.totpEnrolled)} />
));
vi.mock("@/components/account/ChangePasswordForm", () => ({
  ChangePasswordForm: (props: { totpEnrolled: boolean }) => form(props),
}));

import AccountPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

const session = (authMethod: string) => ({
  user: {
    oid: "oid-1",
    name: "Ada Lovelace",
    email: "ada@example.test",
    roles: ["internal-viewer"],
    authMethod,
  },
});

describe("AccountPage", () => {
  it.each([
    ["with TOTP enrolled", { totpCipher: "cipher" }, true],
    ["without TOTP", {}, false],
  ])(
    "a password session sees the change-password form, %s",
    async (_name, credential, enrolled) => {
      auth.mockResolvedValue(session("password"));
      getPasswordCredential.mockResolvedValue({
        email: "ada@example.test",
        status: "enabled",
        ...credential,
      });
      render(await AccountPage());
      expect(
        screen.getByRole("heading", { name: "Account" }),
      ).toBeInTheDocument();
      expect(screen.getByText("ada@example.test")).toBeInTheDocument();
      expect(
        screen.getByRole("form", { name: "Change password" }),
      ).toHaveAttribute("data-totp", String(enrolled));
      expect(getPasswordCredential).toHaveBeenCalledWith("ada@example.test");
    },
  );

  it.each([
    ["entra", "Microsoft Entra ID"],
    ["master", "Master user (break-glass)"],
    ["local", "Local login (dev)"],
  ])(
    "a %s session sees its sign-in method and no form, and no credential is read",
    async (method, label) => {
      auth.mockResolvedValue(session(method));
      render(await AccountPage());
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByRole("form")).toBeNull();
      expect(form).not.toHaveBeenCalled();
      expect(getPasswordCredential).not.toHaveBeenCalled();
    },
  );
});
