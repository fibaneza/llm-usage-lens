import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StepUpDialog } from "./StepUpDialog";
import type { AccessViewer, StepUpActions } from "./types";

// Source: docs/specs/2026-11-10-access-control.md - "Recent authentication"
// (D28: 'Confirm it's you' with the control for the session's own sign-in
// method), threat T32 (the step-up uses the session's own method; the
// identifier comes from the server session). 4R.4 review B3: a dev-login
// session got the password form, which can never succeed for it; it needs its
// own control. Module under test: `StepUpDialog.tsx` with
// `StepUpActions.devLogin(section)` beside `entra` and `credentials`.
function actions() {
  const entra = vi.fn<StepUpActions["entra"]>(async () => undefined);
  const credentials = vi.fn<StepUpActions["credentials"]>(
    async () => undefined,
  );
  const devLogin = vi.fn<StepUpActions["devLogin"]>(async () => undefined);
  return { entra, credentials, devLogin } satisfies StepUpActions;
}

function renderDialog(authMethod: AccessViewer["authMethod"]) {
  const stepUp = actions();
  const onDone = vi.fn();
  render(
    <StepUpDialog
      authMethod={authMethod}
      stepUp={stepUp}
      section="role-grants"
      onDone={onDone}
      onClose={vi.fn()}
    />,
  );
  return { stepUp, onDone };
}

describe("StepUpDialog by sign-in method (B3)", () => {
  it("an Entra session confirms with Microsoft: the click starts the Entra step-up for the section", async () => {
    const { stepUp } = renderDialog("entra");
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm with Microsoft" }),
    );
    expect(stepUp.entra).toHaveBeenCalledWith("role-grants");
    expect(stepUp.credentials).not.toHaveBeenCalled();
    expect(stepUp.devLogin).not.toHaveBeenCalled();
  });

  it("a dev-login session sees its own control, not the password form, and choosing it signs in with the dev login again", async () => {
    const { stepUp, onDone } = renderDialog("local");
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/authenticator code/i),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm with dev login" }),
    );
    expect(stepUp.devLogin).toHaveBeenCalledWith("role-grants");
    expect(stepUp.credentials).not.toHaveBeenCalled();
    expect(stepUp.entra).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it.each(["password", "master"] as const)(
    "a %s session keeps the password and authenticator code form",
    (method) => {
      renderDialog(method);
      expect(screen.getByLabelText("Password")).toBeInTheDocument();
      expect(screen.getByLabelText("Authenticator code")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Confirm with dev login" }),
      ).not.toBeInTheDocument();
    },
  );

  it("a refused dev-login step-up shows the one generic error", async () => {
    const stepUp = actions();
    stepUp.devLogin.mockResolvedValue({ ok: false });
    render(
      <StepUpDialog
        authMethod="local"
        stepUp={stepUp}
        section="password-users"
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm with dev login" }),
    );
    expect(await screen.findByText(/couldn't confirm it's you/i)).toBeVisible();
  });
});
