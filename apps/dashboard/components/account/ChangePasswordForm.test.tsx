import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fail, ok, stubAccessApi } from "@/test/fakes/access-ui-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { ChangePasswordForm } from "./ChangePasswordForm";

// Source: Access Control D30 (an Account page where a password user
// changes their own password: current password, new password, confirm, TOTP
// when enrolled, via POST /api/account/password); Access Control spec -
// "Password users" (Passwords: 12-128 characters, no composition rules, common
// list; TOTP D23), "API routes (additions)" (POST /api/account/password: the
// signed-in password user; current password and TOTP required). Client
// validation messages match components/auth/PasswordSetupForm.tsx. Rule 60.24:
// fetch stubbed.
//
// Module under test: `components/account/ChangePasswordForm.tsx`
//   <ChangePasswordForm totpEnrolled={boolean} />   (client component)
// - Fields: "Current password", "New password", "Confirm new password" and,
//   only when totpEnrolled, "Authenticator code"; submit button "Change
//   password".
// - Body: { currentPassword, newPassword } plus { totp } only when enrolled.
// - Success: a status message "Password changed" and the fields cleared.
// - Any refusal: one generic alert that never echoes the server text.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PATH = "POST /api/account/password";
const CURRENT = "old correct horse battery";
const GOOD = "correct horse battery staple";

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  over: { next?: string; confirm?: string; code?: string } = {},
) {
  await user.type(screen.getByLabelText(/^current password/i), CURRENT);
  await user.type(screen.getByLabelText(/^new password/i), over.next ?? GOOD);
  await user.type(
    screen.getByLabelText(/^confirm new password/i),
    over.confirm ?? over.next ?? GOOD,
  );
  if (over.code !== undefined) {
    await user.type(screen.getByLabelText(/^authenticator code/i), over.code);
  }
}
const submit = () => screen.getByRole("button", { name: /^change password/i });

describe("ChangePasswordForm", () => {
  it("shows the authenticator code field only when TOTP is enrolled", () => {
    stubAccessApi({});
    const { unmount } = renderWithProviders(
      <ChangePasswordForm totpEnrolled={false} />,
    );
    expect(screen.getByLabelText(/^current password/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/authenticator code/i)).toBeNull();
    unmount();
    renderWithProviders(<ChangePasswordForm totpEnrolled />);
    expect(screen.getByLabelText(/^authenticator code/i)).toBeInTheDocument();
  });

  it("posts the current and new password, with no totp when not enrolled, and reports success", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi({ [PATH]: () => ok({}) });
    renderWithProviders(<ChangePasswordForm totpEnrolled={false} />);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("status")).toHaveTextContent(
      /password (has been )?changed/i,
    );
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/account/password",
        body: { currentPassword: CURRENT, newPassword: GOOD },
      }),
    ]);
    expect(screen.getByLabelText(/^new password/i)).toHaveValue("");
    expect(screen.getByLabelText(/^current password/i)).toHaveValue("");
  });

  it("sends the authenticator code as totp when enrolled", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi({ [PATH]: () => ok({}) });
    renderWithProviders(<ChangePasswordForm totpEnrolled />);
    await fill(user, { code: "123456" });
    await user.click(submit());
    await screen.findByRole("status");
    expect(api.writes()[0]?.body).toEqual({
      currentPassword: CURRENT,
      newPassword: GOOD,
      totp: "123456",
    });
  });

  // Same messages as PasswordSetupForm; nothing is sent.
  it.each([
    ["too short", { next: "short" }, /at least 12 characters/i, false],
    ["too long", { next: "a".repeat(129) }, /at most 128 characters/i, false],
    ["too common", { next: "password1234" }, /too common/i, false],
    [
      "not confirmed",
      { next: GOOD, confirm: `${GOOD}x` },
      /passwords do not match/i,
      false,
    ],
    [
      "missing a 6-digit authenticator code",
      { code: "12" },
      /6-digit code from your authenticator app/i,
      true,
    ],
  ])(
    "rejects a new password that is %s inline without sending a request",
    async (_name, over, message, enrolled) => {
      const user = userEvent.setup();
      const api = stubAccessApi({});
      renderWithProviders(<ChangePasswordForm totpEnrolled={enrolled} />);
      await fill(user, over);
      await user.click(submit());
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(api.writes()).toEqual([]);
    },
  );

  it("asks for the current password before sending anything", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi({});
    renderWithProviders(<ChangePasswordForm totpEnrolled={false} />);
    await user.type(screen.getByLabelText(/^new password/i), GOOD);
    await user.type(screen.getByLabelText(/^confirm new password/i), GOOD);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /current password/i,
    );
    expect(api.writes()).toEqual([]);
  });

  it.each([
    ["a refused credential", () => fail(403, "FORBIDDEN", "server text")],
    ["a server error", () => fail(500, "INTERNAL_ERROR", "server text")],
  ])(
    "%s shows one generic error that does not echo the server and keeps the form",
    async (_name, respond) => {
      const user = userEvent.setup();
      stubAccessApi({ [PATH]: respond });
      renderWithProviders(<ChangePasswordForm totpEnrolled={false} />);
      await fill(user);
      await user.click(submit());
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/could not change .*password/i);
      expect(alert).not.toHaveTextContent("server text");
      expect(screen.queryByRole("status")).toBeNull();
      expect(submit()).toBeEnabled();
    },
  );

  it("sends one request when the form is submitted twice quickly", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi({ [PATH]: () => ok({}) });
    renderWithProviders(<ChangePasswordForm totpEnrolled={false} />);
    await fill(user);
    await user.dblClick(submit());
    await screen.findByRole("status");
    expect(api.writes()).toHaveLength(1);
  });
});
