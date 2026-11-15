import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fail,
  ok,
  page,
  passwordUserItem,
  stubAccessApi,
} from "@/test/access-ui-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { PasswordUsersSection } from "./PasswordUsersSection";
import type { AccessViewer, StepUpActions } from "./types";

// Source: docs/specs/2026-11-10-access-control.md - "Password users" (only an
// internal-admin creates, disables, re-enables, resets or deletes; Setup D22:
// creating or resetting returns a one-time setup link in exactly one response,
// `https://<host>/account/setup#<token>`, never stored or shown again - the
// token lives in the fragment so it never reaches access logs; Alongside Entra
// D24: the GOVERNANCE/PASSWORD_SIGNIN switch, audited and versioned; the last
// enabled password internal-admin is protected: 409), "SSO reference and
// binding" (bound users: Entra is their only sign-in; SSO_BOUND 409), "API
// routes (additions)" (/api/password-users GET POST; .../[email] PATCH DELETE;
// .../reset and .../totp-reset POST; /api/governance/password-sign-in GET PUT),
// threat T24 (token handling). Design System - Settings Page ("create with a
// one-time setup link shown once, reset, TOTP reset, disable, delete, the SSO
// reference, bind status ...; the password sign-in switch"). Rule 60.24.
//
// Module under test: `components/settings/access/PasswordUsersSection.tsx`
//   <PasswordUsersSection canEdit={boolean} />
// - Rows: email, display name, a status badge (Enabled / Pending setup /
//   Disabled / SSO bound), TOTP "Enrolled" / "Not enrolled".
// - Icon buttons labelled "Reset password for <email>", "Reset authenticator
//   for <email>", "Disable <email>" / "Enable <email>", "Delete <email>".
//   An SSO-bound row has no reset, disable or enable.
// - "Create password user" dialog: fields "Work email", "Display name",
//   "Expected UPN (optional)", "Entra object ID (optional)"; submit
//   "Create user".
// - Setup link dialog (name contains "Setup link"): read-only text field
//   "Setup link" with the link, button "Copy link", the words "not be shown
//   again", the 72-hour expiry, button "Done". The link is plain text, never
//   an <a href>, never in the page URL, web storage or the list data.
// - Re-authentication (D33): the props are `canEdit`, `authMethod` and
//   `stepUp` (the same StepUpActions as RoleGrantsSection, whose
//   `entra(section)` and `credentials(form, section)` take the section key;
//   this section passes "password-users").
// - A switch (role="switch") named "Password sign-in" from /api/governance/
//   password-sign-in.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

const TOKEN = "tok-AbCdEf0123456789-one-time";
const LINK = `https://dash.example.com/account/setup#${TOKEN}`;

function stepUpMocks() {
  const entra = vi.fn<StepUpActions["entra"]>(async () => undefined);
  const credentials = vi.fn<StepUpActions["credentials"]>(
    async () => undefined,
  );
  const devLogin = vi.fn<StepUpActions["devLogin"]>(async () => undefined);
  return { entra, credentials, devLogin } satisfies StepUpActions;
}

function renderSection({
  stepUp = stepUpMocks(),
  authMethod = "entra",
  canEdit = true,
}: {
  stepUp?: StepUpActions;
  authMethod?: AccessViewer["authMethod"];
  canEdit?: boolean;
} = {}) {
  return renderWithProviders(
    <PasswordUsersSection
      canEdit={canEdit}
      authMethod={authMethod}
      stepUp={stepUp}
    />,
  );
}

const CAROL = passwordUserItem();
const DAVE = passwordUserItem({
  email: "dave@example.com",
  displayName: "Dave Dunn",
  status: "pending-setup",
  totpEnrolled: false,
  version: 1,
});
const ERIN = passwordUserItem({
  email: "erin@example.com",
  displayName: "Erin Ellis",
  status: "disabled",
  version: 5,
});
const FRANK = passwordUserItem({
  email: "frank@example.com",
  displayName: "Frank Fox",
  status: "sso-bound",
  version: 7,
});

function routes(extra: Record<string, unknown> = {}) {
  return {
    "GET /api/password-users": page([CAROL, DAVE, ERIN, FRANK]),
    "GET /api/governance/password-sign-in": { enabled: true, version: 1 },
    ...extra,
  };
}

describe("PasswordUsersSection - list", () => {
  it("shows each user's status and authenticator enrolment", async () => {
    stubAccessApi(routes());
    renderSection();
    const carol = await screen.findByRole("row", { name: /carol@example.com/ });
    expect(within(carol).getByText("Enabled")).toBeInTheDocument();
    expect(within(carol).getByText("Enrolled")).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /dave@/ })).getByText(
        "Pending setup",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /dave@/ })).getByText(
        "Not enrolled",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /erin@/ })).getByText("Disabled"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /frank@/ })).getByText(
        "SSO bound",
      ),
    ).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    stubAccessApi(routes({ "GET /api/password-users": page([]) }));
    renderSection();
    expect(await screen.findByText(/no password users/i)).toBeInTheDocument();
  });

  it("offers per-row actions by state; an SSO-bound row has no reset, disable or enable", async () => {
    stubAccessApi(routes());
    renderSection();
    await screen.findByRole("row", { name: /carol@/ });
    for (const name of [
      "Reset password for carol@example.com",
      "Reset authenticator for carol@example.com",
      "Disable carol@example.com",
      "Delete carol@example.com",
      "Enable erin@example.com",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: "Enable carol@example.com" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /(reset|disable|enable).*frank@/i }),
    ).not.toBeInTheDocument();
  });

  it("is read-only for an auditor: no create, row actions, and a disabled switch", async () => {
    stubAccessApi(routes());
    renderSection({ canEdit: false });
    await screen.findByRole("row", { name: /carol@/ });
    expect(
      screen.queryByRole("button", { name: "Create password user" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^(Reset|Disable|Enable|Delete) / }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("switch", { name: "Password sign-in" }),
    ).toBeDisabled();
  });
});

describe("PasswordUsersSection - create and the one-time setup link", () => {
  async function createUser(
    user: ReturnType<typeof userEvent.setup>,
    extraRoutes: Record<string, unknown> = {},
  ) {
    const api = stubAccessApi(
      routes({
        "POST /api/password-users": () =>
          ok(
            {
              user: passwordUserItem({
                email: "gina@example.com",
                displayName: "Gina Grey",
                status: "pending-setup",
                totpEnrolled: false,
                version: 1,
              }),
              setupLink: LINK,
            },
            201,
          ),
        ...extraRoutes,
      }),
    );
    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Create password user" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Work email"),
      "gina@example.com",
    );
    await user.type(within(dialog).getByLabelText("Display name"), "Gina Grey");
    return { api, dialog };
  }

  it("validates the email and display name before sending", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(routes());
    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Create password user" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Work email"),
      "not-an-email",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create user" }),
    );
    expect(await within(dialog).findByText(/valid email/i)).toBeVisible();
    expect(within(dialog).getByText(/display name is required/i)).toBeVisible();
    expect(within(dialog).getByLabelText("Work email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(api.writes()).toEqual([]);
  });

  it("creates the user (no SSO fields -> none sent) and shows the link once", async () => {
    const user = userEvent.setup();
    const { api, dialog } = await createUser(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Create user" }),
    );
    const linkDialog = await screen.findByRole("dialog", {
      name: /setup link/i,
    });
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/password-users",
        body: { email: "gina@example.com", displayName: "Gina Grey" },
      }),
    ]);
    const field = within(linkDialog).getByLabelText("Setup link");
    expect(field).toHaveValue(LINK);
    expect(field).toHaveAttribute("readonly");
    expect(linkDialog).toHaveTextContent(/not be shown again/i);
    expect(linkDialog).toHaveTextContent(/72 hours/i);
  });

  it("sends the SSO reference only when entered", async () => {
    const user = userEvent.setup();
    const { api, dialog } = await createUser(user);
    await user.type(
      within(dialog).getByLabelText("Expected UPN (optional)"),
      "gina@corp.example.com",
    );
    await user.type(
      within(dialog).getByLabelText("Entra object ID (optional)"),
      "11111111-2222-3333-4444-555555555555",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create user" }),
    );
    await screen.findByRole("dialog", { name: /setup link/i });
    expect(api.writes()[0]?.body).toMatchObject({
      sso: {
        expectedUpn: "gina@corp.example.com",
        expectedOid: "11111111-2222-3333-4444-555555555555",
      },
    });
  });

  it("copies the link to the clipboard", async () => {
    const user = userEvent.setup();
    const { dialog } = await createUser(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Create user" }),
    );
    const linkDialog = await screen.findByRole("dialog", {
      name: /setup link/i,
    });
    await user.click(
      within(linkDialog).getByRole("button", { name: "Copy link" }),
    );
    expect(await navigator.clipboard.readText()).toBe(LINK);
    expect(await screen.findByRole("status")).toHaveTextContent(/copied/i);
  });

  it("never puts the link in a URL, an anchor, web storage or the list; closing discards it", async () => {
    const user = userEvent.setup();
    const before = window.location.href;
    const { dialog } = await createUser(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Create user" }),
    );
    const linkDialog = await screen.findByRole("dialog", {
      name: /setup link/i,
    });
    expect(document.querySelector("a[href*='account/setup']")).toBeNull();
    expect(window.location.href).toBe(before);
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain(TOKEN);
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain(TOKEN);
    await user.click(within(linkDialog).getByRole("button", { name: "Done" }));
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(document.querySelector(`input[value*="${TOKEN}"]`)).toBeNull();
    expect(window.location.href).toBe(before);
  });

  it("maps a duplicate email (409) to a readable message and keeps the dialog open", async () => {
    const user = userEvent.setup();
    const { dialog } = await createUser(user, {
      "POST /api/password-users": () => fail(409, "CONFLICT"),
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Create user" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /reload|conflict|already/i,
    );
    expect(screen.queryByRole("dialog", { name: /setup link/i })).toBeNull();
  });
});

describe("PasswordUsersSection - reset, disable, delete", () => {
  it("resets a password after confirming and shows the new link once", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "POST /api/password-users/carol@example.com/reset": () =>
          ok({ user: { ...CAROL, status: "pending-setup" }, setupLink: LINK }),
      }),
    );
    renderSection();
    await user.click(
      await screen.findByRole("button", {
        name: "Reset password for carol@example.com",
      }),
    );
    const confirm = await screen.findByRole("dialog");
    expect(confirm).toHaveTextContent(/old (setup )?link|invalidat/i);
    expect(api.writes()).toEqual([]);
    await user.click(
      within(confirm).getByRole("button", { name: "Reset password" }),
    );
    const linkDialog = await screen.findByRole("dialog", {
      name: /setup link/i,
    });
    expect(within(linkDialog).getByLabelText("Setup link")).toHaveValue(LINK);
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/password-users/carol@example.com/reset",
      }),
    ]);
  });

  it("maps SSO_BOUND on reset to a message pointing at Entra", async () => {
    const user = userEvent.setup();
    stubAccessApi(
      routes({
        "POST /api/password-users/carol@example.com/reset": () =>
          fail(409, "SSO_BOUND"),
      }),
    );
    renderSection();
    await user.click(
      await screen.findByRole("button", {
        name: "Reset password for carol@example.com",
      }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Reset password",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /sso|single sign-on|entra/i,
    );
  });

  it("resets the authenticator after confirming and says re-enrolment is at next sign-in", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "POST /api/password-users/carol@example.com/totp-reset": () =>
          ok({ ...CAROL, totpEnrolled: false }),
      }),
    );
    renderSection();
    await user.click(
      await screen.findByRole("button", {
        name: "Reset authenticator for carol@example.com",
      }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Reset authenticator",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      /re-?enrol|next sign-in/i,
    );
    expect(api.writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/password-users/carol@example.com/totp-reset",
    ]);
  });

  it("disables and enables with PATCH {enabled, version}", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "PATCH /api/password-users/carol@example.com": () => ok(CAROL),
        "PATCH /api/password-users/erin@example.com": () => ok(ERIN),
      }),
    );
    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Disable carol@example.com" }),
    );
    await vi.waitFor(() => expect(api.writes()).toHaveLength(1));
    await user.click(
      screen.getByRole("button", { name: "Enable erin@example.com" }),
    );
    await vi.waitFor(() => expect(api.writes()).toHaveLength(2));
    expect(api.writes().map((c) => c.body)).toEqual([
      { enabled: false, version: 3 },
      { enabled: true, version: 5 },
    ]);
  });

  it("shows a readable message when the last enabled admin cannot be disabled (409)", async () => {
    const user = userEvent.setup();
    stubAccessApi(
      routes({
        "PATCH /api/password-users/carol@example.com": () =>
          fail(409, "CONFLICT"),
      }),
    );
    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Disable carol@example.com" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/reload/i);
  });

  it("deletes only after confirming", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "DELETE /api/password-users/carol@example.com": () =>
          ok({ deleted: true }),
      }),
    );
    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Delete carol@example.com" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(api.writes()).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await vi.waitFor(() =>
      expect(api.writes().map((c) => `${c.method} ${c.path}`)).toEqual([
        "DELETE /api/password-users/carol@example.com",
      ]),
    );
  });
});

describe("PasswordUsersSection - password sign-in switch (D24)", () => {
  it("reflects the stored state", async () => {
    stubAccessApi(routes());
    renderSection();
    expect(
      await screen.findByRole("switch", { name: "Password sign-in" }),
    ).toBeChecked();
  });

  it("turns it off with PUT {enabled, version}", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "PUT /api/governance/password-sign-in": () =>
          ok({ enabled: false, version: 2 }),
      }),
    );
    renderSection();
    await user.click(
      await screen.findByRole("switch", { name: "Password sign-in" }),
    );
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          method: "PUT",
          path: "/api/governance/password-sign-in",
          body: { enabled: false, version: 1 },
        }),
      ]),
    );
  });

  it("explains a refusal (Entra not configured) and leaves the switch on", async () => {
    const user = userEvent.setup();
    stubAccessApi(
      routes({
        "PUT /api/governance/password-sign-in": () => fail(409, "CONFLICT"),
      }),
    );
    renderSection();
    const toggle = await screen.findByRole("switch", {
      name: "Password sign-in",
    });
    await user.click(toggle);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await vi.waitFor(() => expect(toggle).toBeChecked());
  });
});

// Access Control spec - "Recent authentication" (D28, D33), threats T24/T32:
// the re-auth writes (create, reset, TOTP reset, delete, the password sign-in
// switch) answer 403 REAUTH_REQUIRED without a recent sign-in; the section
// opens the same "Confirm it's you" dialog as Role grants, never replays the
// write, keeps no draft or secret in the URL or storage, and a second
// REAUTH_REQUIRED straight after a step-up is an error.
describe("PasswordUsersSection - re-authentication (D33)", () => {
  const reauth = () =>
    fail(403, "REAUTH_REQUIRED", "Re-authentication required");

  const operations = [
    {
      name: "create",
      route: "POST /api/password-users",
      start: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(
          await screen.findByRole("button", { name: "Create password user" }),
        );
        const dialog = await screen.findByRole("dialog");
        await user.type(
          within(dialog).getByLabelText("Work email"),
          "gina@example.com",
        );
        await user.type(
          within(dialog).getByLabelText("Display name"),
          "Gina Grey",
        );
        await user.click(
          within(dialog).getByRole("button", { name: "Create user" }),
        );
      },
    },
    {
      name: "reset password",
      route: "POST /api/password-users/carol@example.com/reset",
      start: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(
          await screen.findByRole("button", {
            name: "Reset password for carol@example.com",
          }),
        );
        await user.click(
          within(await screen.findByRole("dialog")).getByRole("button", {
            name: "Reset password",
          }),
        );
      },
    },
    {
      name: "reset authenticator",
      route: "POST /api/password-users/carol@example.com/totp-reset",
      start: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(
          await screen.findByRole("button", {
            name: "Reset authenticator for carol@example.com",
          }),
        );
        await user.click(
          within(await screen.findByRole("dialog")).getByRole("button", {
            name: "Reset authenticator",
          }),
        );
      },
    },
    {
      name: "delete",
      route: "DELETE /api/password-users/carol@example.com",
      start: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(
          await screen.findByRole("button", {
            name: "Delete carol@example.com",
          }),
        );
        await user.click(
          within(await screen.findByRole("dialog")).getByRole("button", {
            name: "Delete",
          }),
        );
      },
    },
    {
      name: "password sign-in switch",
      route: "PUT /api/governance/password-sign-in",
      start: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(
          await screen.findByRole("switch", { name: "Password sign-in" }),
        );
      },
    },
  ];

  it.each(operations)(
    "$name on REAUTH_REQUIRED opens 'Confirm it's you' and does not replay the write",
    async ({ route, start }) => {
      const user = userEvent.setup();
      const stepUp = stepUpMocks();
      const api = stubAccessApi(routes({ [route]: reauth }));
      renderSection({ stepUp });
      await start(user);
      const confirm = await screen.findByRole("dialog", {
        name: /confirm it's you/i,
      });
      expect(
        within(confirm).getByRole("button", { name: "Confirm with Microsoft" }),
      ).toBeInTheDocument();
      expect(api.to(route)).toHaveLength(1);
      expect(stepUp.entra).not.toHaveBeenCalled();
      expect(stepUp.credentials).not.toHaveBeenCalled();
    },
  );

  it.each(operations)(
    "$name: a second REAUTH_REQUIRED straight after a step-up shows the not-recent error",
    async ({ route, start }) => {
      const user = userEvent.setup();
      const stepUp = stepUpMocks();
      stubAccessApi(routes({ [route]: reauth }));
      renderSection({ stepUp });
      await start(user);
      await user.click(
        await screen.findByRole("button", { name: "Confirm with Microsoft" }),
      );
      await vi.waitFor(() => expect(stepUp.entra).toHaveBeenCalledTimes(1));
      await vi.waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: /confirm it's you/i }),
        ).not.toBeInTheDocument(),
      );
      // The form or confirm dialog may stay open after the step-up (submit it
      // again) or close (start the action again); both are valid.
      const open = screen.queryByRole("dialog");
      const again = open
        ? within(open).queryByRole("button", {
            name: /^(Create user|Reset password|Reset authenticator|Delete)$/,
          })
        : null;
      if (again) await user.click(again);
      else await start(user);
      expect(
        await screen.findByText(
          /your sign-in could not be confirmed as recent/i,
        ),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Confirm with Microsoft" }),
      ).not.toBeInTheDocument();
      expect(stepUp.entra).toHaveBeenCalledTimes(1);
    },
  );

  it("an Entra step-up carries the password-users section key", async () => {
    const user = userEvent.setup();
    const stepUp = stepUpMocks();
    stubAccessApi(
      routes({ "DELETE /api/password-users/carol@example.com": reauth }),
    );
    renderSection({ stepUp });
    await operations[3]?.start(user);
    await user.click(
      await screen.findByRole("button", { name: "Confirm with Microsoft" }),
    );
    await vi.waitFor(() =>
      expect(stepUp.entra).toHaveBeenCalledWith("password-users"),
    );
  });

  it.each(["password", "master"] as const)(
    "a %s session re-enters password and code; credentials(form, 'password-users') with no identifier",
    async (authMethod) => {
      const user = userEvent.setup();
      const stepUp = stepUpMocks();
      stubAccessApi(
        routes({ "DELETE /api/password-users/carol@example.com": reauth }),
      );
      renderSection({ stepUp, authMethod });
      await operations[3]?.start(user);
      const confirm = await screen.findByRole("dialog", {
        name: /confirm it's you/i,
      });
      expect(
        within(confirm).queryByRole("button", {
          name: "Confirm with Microsoft",
        }),
      ).toBeNull();
      await user.type(
        within(confirm).getByLabelText("Password"),
        "pw-correct-1",
      );
      await user.type(
        within(confirm).getByLabelText("Authenticator code"),
        "123456",
      );
      await user.click(
        within(confirm).getByRole("button", { name: "Confirm" }),
      );
      await vi.waitFor(() =>
        expect(stepUp.credentials).toHaveBeenCalledTimes(1),
      );
      const [form, section] = stepUp.credentials.mock.calls[0] ?? [];
      expect(section).toBe("password-users");
      expect(form?.get("password")).toBe("pw-correct-1");
      expect(form?.get("totp")).toBe("123456");
      expect(form?.has("email")).toBe(false);
      expect(form?.has("username")).toBe(false);
      expect(stepUp.entra).not.toHaveBeenCalled();
    },
  );

  it("after the step-up the admin submits create again with the draft intact; the link is never stored", async () => {
    const user = userEvent.setup();
    const before = window.location.href;
    let attempt = 0;
    const api = stubAccessApi(
      routes({
        "POST /api/password-users": () =>
          ++attempt === 1
            ? reauth()
            : ok(
                {
                  user: passwordUserItem({
                    email: "gina@example.com",
                    displayName: "Gina Grey",
                    status: "pending-setup",
                    totpEnrolled: false,
                    version: 1,
                  }),
                  setupLink: LINK,
                },
                201,
              ),
      }),
    );
    renderSection();
    await operations[0]?.start(user);
    await user.click(
      await screen.findByRole("button", { name: "Confirm with Microsoft" }),
    );
    const form = await screen.findByRole("dialog", {
      name: /create password user/i,
    });
    expect(within(form).getByLabelText("Work email")).toHaveValue(
      "gina@example.com",
    );
    expect(within(form).getByLabelText("Display name")).toHaveValue(
      "Gina Grey",
    );
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain(
      "gina@example.com",
    );
    expect(window.location.href).toBe(before);
    await user.click(within(form).getByRole("button", { name: "Create user" }));
    await screen.findByRole("dialog", { name: /setup link/i });
    expect(api.to("POST /api/password-users")).toHaveLength(2);
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain(TOKEN);
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain(TOKEN);
    expect(window.location.href).toBe(before);
  });
});
