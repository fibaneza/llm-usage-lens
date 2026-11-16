import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

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

// Access Control D33 (review D step-up return): a successful step-up ends in a
// server-action redirect, which Next surfaces as a thrown NEXT_REDIRECT error.
// It is navigation, not a failure: the dialog must not show the failure
// message, and the error must propagate so Next can navigate. A genuine
// failure still shows the one generic message.
describe("StepUpDialog and the step-up redirect (D33)", () => {
  const listeners = process.listeners("unhandledRejection");
  afterEach(() => {
    process.removeAllListeners("unhandledRejection");
    for (const l of listeners) process.on("unhandledRejection", l);
  });

  function redirectError(): unknown {
    try {
      redirect("/dashboard/settings/access/roles");
    } catch (error) {
      return error;
    }
    throw new Error("redirect() did not throw");
  }

  it("a thrown Next redirect shows no failure message and is re-thrown, not swallowed", async () => {
    const seen: unknown[] = [];
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", (reason) => seen.push(reason));
    const thrown = redirectError();
    const stepUp = actions();
    stepUp.devLogin.mockRejectedValue(thrown);
    render(
      <StepUpDialog
        authMethod="local"
        stepUp={stepUp}
        section="role-grants"
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm with dev login" }),
    );
    await vi.waitFor(() => expect(seen).toContain(thrown));
    expect(screen.queryByText(/couldn't confirm it's you/i)).toBeNull();
  });

  it("a genuine thrown failure still shows the one generic message", async () => {
    const seen: unknown[] = [];
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", (reason) => seen.push(reason));
    const stepUp = actions();
    stepUp.devLogin.mockRejectedValue(new Error("boom"));
    render(
      <StepUpDialog
        authMethod="local"
        stepUp={stepUp}
        section="role-grants"
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm with dev login" }),
    );
    expect(
      await screen.findByText(/couldn't confirm it's you/i),
    ).toBeInTheDocument();
    expect(seen).toEqual([]);
  });
});
