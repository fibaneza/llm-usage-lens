import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ORG_ROUTES,
  fail,
  ok,
  page,
  roleGrantItem,
  stubAccessApi,
} from "@/test/fakes/access-ui-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { RoleGrantsSection } from "./RoleGrantsSection";
import type { AccessViewer, StepUpActions } from "./types";

// Source: docs/specs/2026-11-10-access-control.md - "Roles" (grant or revoke
// internal-org-admin / internal-admin: internal-admin only; the last
// internal-admin grant cannot be revoked: 409), "Recent authentication" (D28:
// the write answers 403 REAUTH_REQUIRED without a sign-in in the last 15
// minutes; UI: 'Confirm it's you' with the control for session.user.authMethod
// - a button for Entra, password and TOTP fields otherwise; it never replays
// the write; the unsent draft (target, role, reason; no secrets) is never in
// the URL; a second REAUTH_REQUIRED straight after a step-up shows 'Your
// sign-in could not be confirmed as recent' instead of another step-up; a
// failed step-up returns one generic error and leaves the session), "API routes
// (additions)" (/api/role-grants GET POST {oid, role, reason}; /api/role-
// grants/[oid]/[role] DELETE {version}), threat T32. Design System - Settings
// Page ("Role grants (re-authentication prompt and reason field)").
//
// Module under test: `components/settings/access/RoleGrantsSection.tsx`
//   <RoleGrantsSection canEdit={boolean}
//                      authMethod={AccessViewer["authMethod"]}
//                      stepUp={StepUpActions} />
// - Rows: person name, role label (Org admin / Admin), reason, granted-by,
//   date. Revoke icon button: aria-label "Revoke <Role> from <name>".
// - "Grant role" button -> dialog with selects "Person" and "Role" and a
//   "Reason" textarea; submit "Grant".
// - Step-up dialog (accessible name "Confirm it's you"): Entra -> button
//   "Confirm with Microsoft" calling stepUp.entra(); password / master ->
//   fields "Password" and "Authenticator code" and button "Confirm" calling
//   stepUp.credentials(formData with `password`, `totp`; never an email or
//   username - the server takes the identifier from the session).
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

const REASON = "Finance reporting owner";

function stepUpMocks() {
  const entra = vi.fn<StepUpActions["entra"]>(async () => undefined);
  const credentials = vi.fn<StepUpActions["credentials"]>(
    async () => undefined,
  );
  const devLogin = vi.fn<StepUpActions["devLogin"]>(async () => undefined);
  return { entra, credentials, devLogin } satisfies StepUpActions;
}

function routes(extra: Record<string, unknown> = {}) {
  return {
    ...ORG_ROUTES,
    "GET /api/role-grants": page([
      roleGrantItem(),
      roleGrantItem({
        oid: "oid-bob",
        role: "internal-admin",
        reason: "Platform owner",
        version: 6,
      }),
    ]),
    ...extra,
  };
}

function renderSection(
  stepUp: StepUpActions,
  authMethod: AccessViewer["authMethod"] = "entra",
  canEdit = true,
) {
  return renderWithProviders(
    <RoleGrantsSection
      canEdit={canEdit}
      authMethod={authMethod}
      stepUp={stepUp}
    />,
  );
}

async function openGrantDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Grant role" }));
  return screen.findByRole("dialog");
}

async function fillGrant(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
) {
  await user.selectOptions(
    within(dialog).getByLabelText("Person"),
    "Alice Adams (alice@example.com)",
  );
  await user.selectOptions(within(dialog).getByLabelText("Role"), "Org admin");
  await user.type(within(dialog).getByLabelText("Reason"), REASON);
}

describe("RoleGrantsSection", () => {
  it("lists grants with the person, role label, reason and grantor", async () => {
    stubAccessApi(routes());
    renderSection(stepUpMocks());
    const alice = await screen.findByRole("row", { name: /Alice Adams/ });
    expect(within(alice).getByText("Org admin")).toBeInTheDocument();
    expect(within(alice).getByText(REASON)).toBeInTheDocument();
    expect(
      screen.getByRole("row", { name: /Bob Brown.*Admin.*Platform owner/s }),
    ).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    stubAccessApi(routes({ "GET /api/role-grants": page([]) }));
    renderSection(stepUpMocks());
    expect(await screen.findByText(/no role grants/i)).toBeInTheDocument();
  });

  it("is read-only for an auditor", async () => {
    stubAccessApi(routes());
    renderSection(stepUpMocks(), "entra", false);
    await screen.findByRole("row", { name: /Alice Adams/ });
    expect(
      screen.queryByRole("button", { name: "Grant role" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Revoke/ }),
    ).not.toBeInTheDocument();
  });

  it("requires a person and a reason before sending", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(routes());
    renderSection(stepUpMocks());
    const dialog = await openGrantDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Grant" }));
    expect(await within(dialog).findByText(/choose a person/i)).toBeVisible();
    expect(within(dialog).getByText(/reason is required/i)).toBeVisible();
    expect(within(dialog).getByLabelText("Reason")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(api.writes()).toEqual([]);
  });

  it("rejects a reason over 500 characters", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(routes());
    renderSection(stepUpMocks());
    const dialog = await openGrantDialog(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Person"),
      "Alice Adams (alice@example.com)",
    );
    await user.click(within(dialog).getByLabelText("Reason"));
    await user.paste("x".repeat(501));
    await user.click(within(dialog).getByRole("button", { name: "Grant" }));
    expect(await within(dialog).findByText(/500/)).toBeVisible();
    expect(api.writes()).toEqual([]);
  });

  it("grants a role: POST {oid, role, reason}, then closes the dialog", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "POST /api/role-grants": () =>
          ok(roleGrantItem({ reason: REASON }), 201),
      }),
    );
    renderSection(stepUpMocks());
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Grant" }));
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          method: "POST",
          path: "/api/role-grants",
          body: {
            oid: "oid-alice",
            role: "internal-org-admin",
            reason: REASON,
          },
        }),
      ]),
    );
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("revokes after confirming, sending the grant's version in the DELETE body", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "DELETE /api/role-grants/oid-alice/internal-org-admin": () =>
          ok({ oid: "oid-alice", role: "internal-org-admin" }),
      }),
    );
    renderSection(stepUpMocks());
    await user.click(
      await screen.findByRole("button", {
        name: "Revoke Org admin from Alice Adams",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(api.writes()).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          method: "DELETE",
          path: "/api/role-grants/oid-alice/internal-org-admin",
          body: { version: 1 },
        }),
      ]),
    );
  });

  it("surfaces the last-admin 409 as a readable message", async () => {
    const user = userEvent.setup();
    stubAccessApi(
      routes({
        "DELETE /api/role-grants/oid-bob/internal-admin": () =>
          fail(
            409,
            "CONFLICT",
            "The last internal-admin grant cannot be revoked",
          ),
      }),
    );
    renderSection(stepUpMocks());
    await user.click(
      await screen.findByRole("button", {
        name: "Revoke Admin from Bob Brown",
      }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Revoke",
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/reload|last/i);
  });
});

function dump(store: Storage): string {
  return Array.from({ length: store.length }, (_, i) => {
    const key = store.key(i) ?? "";
    return `${key}=${store.getItem(key) ?? ""}`;
  }).join("|");
}

describe("RoleGrantsSection - re-authentication (D28)", () => {
  const reauth = () =>
    fail(403, "REAUTH_REQUIRED", "Re-authentication required");

  it("opens 'Confirm it's you' with a Microsoft button for an Entra session; no other fields", async () => {
    const user = userEvent.setup();
    stubAccessApi(routes({ "POST /api/role-grants": reauth }));
    renderSection(stepUpMocks(), "entra");
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Grant" }));
    const confirm = await screen.findByRole("dialog", {
      name: /confirm it's you/i,
    });
    expect(
      within(confirm).getByRole("button", { name: "Confirm with Microsoft" }),
    ).toBeInTheDocument();
    expect(within(confirm).queryByLabelText("Password")).toBeNull();
  });

  it("runs the Entra step-up on click and does NOT replay the write", async () => {
    const user = userEvent.setup();
    const stepUp = stepUpMocks();
    const api = stubAccessApi(routes({ "POST /api/role-grants": reauth }));
    renderSection(stepUp, "entra");
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Grant" }));
    await user.click(
      await screen.findByRole("button", { name: "Confirm with Microsoft" }),
    );
    await vi.waitFor(() => expect(stepUp.entra).toHaveBeenCalledTimes(1));
    expect(api.to("POST /api/role-grants")).toHaveLength(1);
  });

  // Access Control spec - "Recent authentication" (D33): the step-up names its
  // return section; Role grants uses "role-grants".
  it("the Entra step-up carries the role-grants section key", async () => {
    const user = userEvent.setup();
    const stepUp = stepUpMocks();
    stubAccessApi(routes({ "POST /api/role-grants": reauth }));
    renderSection(stepUp, "entra");
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Grant" }));
    await user.click(
      await screen.findByRole("button", { name: "Confirm with Microsoft" }),
    );
    await vi.waitFor(() =>
      expect(stepUp.entra).toHaveBeenCalledWith("role-grants"),
    );
  });

  it("the credential step-up carries the role-grants section key", async () => {
    const user = userEvent.setup();
    const stepUp = stepUpMocks();
    stubAccessApi(routes({ "POST /api/role-grants": reauth }));
    renderSection(stepUp, "password");
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Grant" }));
    const confirm = await screen.findByRole("dialog", {
      name: /confirm it's you/i,
    });
    await user.type(within(confirm).getByLabelText("Password"), "pw-correct-1");
    await user.click(within(confirm).getByRole("button", { name: "Confirm" }));
    await vi.waitFor(() => expect(stepUp.credentials).toHaveBeenCalledTimes(1));
    expect(stepUp.credentials.mock.calls[0]?.[1]).toBe("role-grants");
  });

  it("after the step-up the admin submits again, with the draft intact", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const api = stubAccessApi(
      routes({
        "POST /api/role-grants": () =>
          ++attempt === 1 ? reauth() : ok(roleGrantItem(), 201),
      }),
    );
    renderSection(stepUpMocks(), "entra");
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Grant" }));
    await user.click(
      await screen.findByRole("button", { name: "Confirm with Microsoft" }),
    );
    const form = await screen.findByRole("dialog", { name: /grant role/i });
    expect(within(form).getByLabelText("Reason")).toHaveValue(REASON);
    expect(within(form).getByLabelText("Person")).toHaveDisplayValue(
      "Alice Adams (alice@example.com)",
    );
    await user.click(within(form).getByRole("button", { name: "Grant" }));
    await vi.waitFor(() =>
      expect(api.to("POST /api/role-grants")).toHaveLength(2),
    );
    expect(api.to("POST /api/role-grants")[1]?.body).toEqual({
      oid: "oid-alice",
      role: "internal-org-admin",
      reason: REASON,
    });
  });

  it("a second REAUTH_REQUIRED straight after a step-up shows an error instead of another step-up", async () => {
    const user = userEvent.setup();
    const stepUp = stepUpMocks();
    stubAccessApi(routes({ "POST /api/role-grants": reauth }));
    renderSection(stepUp, "entra");
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Grant" }));
    await user.click(
      await screen.findByRole("button", { name: "Confirm with Microsoft" }),
    );
    const form = await screen.findByRole("dialog", { name: /grant role/i });
    await user.click(within(form).getByRole("button", { name: "Grant" }));
    expect(
      await screen.findByText(/your sign-in could not be confirmed as recent/i),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Confirm with Microsoft" }),
    ).not.toBeInTheDocument();
    expect(stepUp.entra).toHaveBeenCalledTimes(1);
  });

  it.each(["password", "master"] as const)(
    "a %s session re-enters password and authenticator code, sent without any identifier",
    async (method) => {
      const user = userEvent.setup();
      const stepUp = stepUpMocks();
      stubAccessApi(routes({ "POST /api/role-grants": reauth }));
      renderSection(stepUp, method);
      const dialog = await openGrantDialog(user);
      await fillGrant(user, dialog);
      await user.click(within(dialog).getByRole("button", { name: "Grant" }));
      const confirm = await screen.findByRole("dialog", {
        name: /confirm it's you/i,
      });
      const password = within(confirm).getByLabelText("Password");
      expect(password).toHaveAttribute("type", "password");
      expect(password).toHaveAttribute("autocomplete", "current-password");
      expect(
        within(confirm).getByLabelText("Authenticator code"),
      ).toHaveAttribute("autocomplete", "one-time-code");
      expect(
        within(confirm).queryByRole("button", {
          name: "Confirm with Microsoft",
        }),
      ).toBeNull();
      await user.type(password, "correct horse battery staple");
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
      const form = stepUp.credentials.mock.calls[0]?.[0];
      expect(form?.get("password")).toBe("correct horse battery staple");
      expect(form?.get("totp")).toBe("123456");
      expect(form?.has("email")).toBe(false);
      expect(form?.has("username")).toBe(false);
      expect(stepUp.entra).not.toHaveBeenCalled();
    },
  );

  it("shows one generic error when the credential step-up fails and keeps the dialog", async () => {
    const user = userEvent.setup();
    const stepUp = stepUpMocks();
    stepUp.credentials.mockResolvedValue({ ok: false });
    stubAccessApi(routes({ "POST /api/role-grants": reauth }));
    renderSection(stepUp, "password");
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Grant" }));
    const confirm = await screen.findByRole("dialog", {
      name: /confirm it's you/i,
    });
    await user.type(
      within(confirm).getByLabelText("Password"),
      "wrong-password-1",
    );
    await user.click(within(confirm).getByRole("button", { name: "Confirm" }));
    const alert = await within(confirm).findByRole("alert");
    expect(alert).toHaveTextContent(
      /couldn't confirm|could not confirm|try again/i,
    );
    expect(
      screen.getByRole("dialog", { name: /confirm it's you/i }),
    ).toBeInTheDocument();
  });

  it("a revoke that needs re-authentication also opens the step-up dialog", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "DELETE /api/role-grants/oid-alice/internal-org-admin": reauth,
      }),
    );
    renderSection(stepUpMocks(), "entra");
    await user.click(
      await screen.findByRole("button", {
        name: "Revoke Org admin from Alice Adams",
      }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Revoke",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: /confirm it's you/i }),
    ).toBeInTheDocument();
    expect(api.writes()).toHaveLength(1);
  });

  it("never puts the draft or any secret in the URL or in web storage", async () => {
    const user = userEvent.setup();
    const before = window.location.href;
    stubAccessApi(routes({ "POST /api/role-grants": reauth }));
    renderSection(stepUpMocks(), "password");
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Grant" }));
    const confirm = await screen.findByRole("dialog", {
      name: /confirm it's you/i,
    });
    await user.type(
      within(confirm).getByLabelText("Password"),
      "s3cret-passphrase-value",
    );
    await user.type(
      within(confirm).getByLabelText("Authenticator code"),
      "654321",
    );
    await user.click(within(confirm).getByRole("button", { name: "Confirm" }));
    expect(window.location.href).toBe(before);
    const stored = dump(sessionStorage) + dump(localStorage);
    expect(stored).not.toContain("s3cret-passphrase-value");
    expect(stored).not.toContain("654321");
  });

  it("Escape closes the step-up dialog without running the step-up", async () => {
    const user = userEvent.setup();
    const stepUp = stepUpMocks();
    stubAccessApi(routes({ "POST /api/role-grants": reauth }));
    renderSection(stepUp, "entra");
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Grant" }));
    await screen.findByRole("dialog", { name: /confirm it's you/i });
    await user.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /confirm it's you/i }),
      ).not.toBeInTheDocument(),
    );
    expect(stepUp.entra).not.toHaveBeenCalled();
    expect(stepUp.credentials).not.toHaveBeenCalled();
  });
});
