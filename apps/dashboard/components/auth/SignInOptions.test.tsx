import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SignInOptions } from "./SignInOptions";

// Props: `entra` / `devLogin` flags plus one server-action prop per provider
// (`entraAction`, `devLoginAction`), passed to the matching <form action>. The
// page owns the actions; this component only renders one submit button per
// enabled provider (Rule 50.3). L3c: `devLoginAction` is a React form action
// used through useActionState, `(previous: DevLoginState, formData: FormData)
// => Promise<DevLoginState>` with `DevLoginState = { ok: false } | null`
// (`{ ok: false }` = the sign-in was refused, `null` = nothing to show), the
// same refusal shape as signInWithPasswordSetup.
type DevLoginState = { ok: false } | null;
type DevLoginAction = (
  previous: DevLoginState,
  formData: FormData,
) => Promise<DevLoginState>;
const actions = {
  entraAction: vi.fn(async () => {}),
  devLoginAction: vi.fn<DevLoginAction>(async () => null),
};

const MICROSOFT = /sign in with microsoft/i;
const LOCAL = /sign in as local developer/i;

describe("SignInOptions", () => {
  it("renders only the Microsoft button when only Entra is enabled", () => {
    render(<SignInOptions entra devLogin={false} {...actions} />);

    expect(screen.getByRole("button", { name: MICROSOFT })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(screen.queryByRole("button", { name: LOCAL })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders only the local developer button when only the dev login is enabled", () => {
    render(<SignInOptions entra={false} devLogin {...actions} />);

    expect(screen.getByRole("button", { name: LOCAL })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(screen.queryByRole("button", { name: MICROSOFT })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders both buttons when both providers are enabled", () => {
    render(<SignInOptions entra devLogin {...actions} />);

    expect(screen.getByRole("button", { name: MICROSOFT })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: LOCAL })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("renders no buttons when no provider is enabled", () => {
    render(<SignInOptions entra={false} devLogin={false} {...actions} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("puts each enabled button in its own form", () => {
    const { container } = render(<SignInOptions entra devLogin {...actions} />);

    const forms = container.querySelectorAll("form");
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form.querySelectorAll("button")).toHaveLength(1);
    }
  });
});

describe("SignInOptions local login role choice", () => {
  // Amended M3 (Design System - Management improvements, D14): the select
  // still offers the four global roles; "Team lead" is a fifth, non-role option.
  it("offers the four global roles, defaulting to internal-admin, plus the Team lead option", () => {
    render(<SignInOptions entra={false} devLogin {...actions} />);
    const select = screen.getByLabelText(/role/i) as HTMLSelectElement;
    expect(select.value).toBe("internal-admin");
    expect(
      Array.from(select.options)
        .map((o) => o.value)
        .filter((v) => v.startsWith("internal-"))
        .sort(),
    ).toEqual(
      [
        "internal-admin",
        "internal-auditor",
        "internal-org-admin",
        "internal-viewer",
      ].sort(),
    );
    expect(
      screen.getByRole("option", { name: "Team lead" }),
    ).toBeInTheDocument();
    expect(select.name).toBe("role");
  });

  it("shows no role choice without the local login", () => {
    render(<SignInOptions entra devLogin={false} {...actions} />);
    expect(screen.queryByLabelText(/role/i)).toBeNull();
  });
});

// Access Control - Dev login (L3c): an optional identity next to Role, shown
// only while the dev login is enabled (T7: absent otherwise); a refused
// sign-in is announced, not a 500.
describe("SignInOptions dev identity option", () => {
  it("offers a labelled, optional identity field (Dev login)", () => {
    render(<SignInOptions entra={false} devLogin {...actions} />);
    const field = screen.getByLabelText("Sign in as (email or user id)");
    expect(field).toHaveAttribute("name", "identity");
    expect(field).not.toBeRequired();
  });

  // Dev login (L3c): the submit button names who you will be, so the chosen
  // identity is visible at the point of commitment.
  it("names the typed identity on the submit button, trimmed (Dev login)", async () => {
    render(<SignInOptions entra={false} devLogin {...actions} />);
    expect(
      screen.getByRole("button", { name: "Sign in as local developer" }),
    ).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Sign in as (email or user id)"),
      "  jane@example.com ",
    );

    expect(
      screen.getByRole("button", { name: "Sign in as jane@example.com" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign in as local developer" }),
    ).toBeNull();
  });

  it("renders no identity field without the dev login (T7, Dev login)", () => {
    render(<SignInOptions entra devLogin={false} {...actions} />);
    expect(screen.queryByLabelText(/sign in as/i)).toBeNull();
  });

  // Amended L3c2: the role comes from the stored user, so the Role select is
  // disabled while an identity is typed, with a hint saying why.
  it("enables the Role select and shows no hint while the identity is empty (Dev login, L3c2)", () => {
    render(<SignInOptions entra={false} devLogin {...actions} />);
    expect(screen.getByLabelText(/role/i)).toBeEnabled();
    expect(screen.queryByText(/role comes from the stored user/i)).toBeNull();
  });

  it("disables the Role select and hints that the role comes from the stored user while an identity is typed (Dev login, L3c2)", async () => {
    render(<SignInOptions entra={false} devLogin {...actions} />);
    const user = userEvent.setup();
    const field = screen.getByLabelText("Sign in as (email or user id)");
    await user.type(field, "ada@example.com");

    expect(screen.getByLabelText(/role/i)).toBeDisabled();
    expect(
      screen.getByText(/role comes from the stored user/i),
    ).toBeInTheDocument();

    await user.clear(field);
    expect(screen.getByLabelText(/role/i)).toBeEnabled();
    expect(screen.queryByText(/role comes from the stored user/i)).toBeNull();
  });

  it("submits the typed identity (Dev login)", async () => {
    const devLoginAction = vi.fn<DevLoginAction>(async () => null);
    render(
      <SignInOptions
        entra={false}
        devLogin
        entraAction={actions.entraAction}
        devLoginAction={devLoginAction}
      />,
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Sign in as (email or user id)"),
      "Ada@Example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Sign in as Ada@Example.com" }),
    );

    await waitFor(() => expect(devLoginAction).toHaveBeenCalledTimes(1));
    const formData = devLoginAction.mock.calls[0]?.[1];
    expect(formData?.get("identity")).toBe("Ada@Example.com");
  });

  it("shows a visible alert after a refused sign-in (Dev login: refusal is visible, no 500)", async () => {
    const devLoginAction = vi.fn<DevLoginAction>(async () => ({ ok: false }));
    render(
      <SignInOptions
        entra={false}
        devLogin
        entraAction={actions.entraAction}
        devLoginAction={devLoginAction}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: /sign in as local developer/i }),
      );

    expect(await screen.findByRole("alert")).toHaveTextContent(/\S/);
  });
});

// Design System - Management improvements, "Dev sign-in as a lead" (D14, agent
// decision 2026-11-18): the Team lead choice posts the fixed seeded oid as the
// identity and no role; the typed identity field is disabled while it is
// chosen. T-MI2 (Access Control): no typed value supplies a role or a scope.
describe("SignInOptions team lead sign-in", () => {
  const TEAM_LEAD_OID = "local:team-lead@localhost";

  async function chooseTeamLead() {
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/role/i), "team-lead");
    return user;
  }

  it("names the submit button for the team lead and disables the typed identity field (D14)", async () => {
    render(<SignInOptions entra={false} devLogin {...actions} />);
    await chooseTeamLead();

    expect(
      screen.getByRole("button", { name: "Sign in as team lead" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Sign in as (email or user id)"),
    ).toBeDisabled();
  });

  it("posts the fixed seeded oid as identity and no role (D14, T-MI2)", async () => {
    const devLoginAction = vi.fn<DevLoginAction>(async () => null);
    render(
      <SignInOptions
        entra={false}
        devLogin
        entraAction={actions.entraAction}
        devLoginAction={devLoginAction}
      />,
    );
    const user = await chooseTeamLead();
    await user.click(
      screen.getByRole("button", { name: "Sign in as team lead" }),
    );

    await waitFor(() => expect(devLoginAction).toHaveBeenCalledTimes(1));
    const formData = devLoginAction.mock.calls[0]?.[1];
    expect(formData?.get("identity")).toBe(TEAM_LEAD_OID);
    expect(formData?.has("role")).toBe(false);
  });

  it("is absent where the dev login is absent: Entra only (T-MI2, T7)", () => {
    render(<SignInOptions entra devLogin={false} {...actions} />);
    expect(screen.queryByRole("option", { name: "Team lead" })).toBeNull();
    expect(screen.queryByText(/team lead/i)).toBeNull();
  });
});
