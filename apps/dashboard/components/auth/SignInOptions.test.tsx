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
  it("offers the four global roles, defaulting to internal-admin", () => {
    render(<SignInOptions entra={false} devLogin {...actions} />);
    const select = screen.getByLabelText(/role/i) as HTMLSelectElement;
    expect(select.value).toBe("internal-admin");
    expect(
      Array.from(select.options)
        .map((o) => o.value)
        .sort(),
    ).toEqual(
      [
        "internal-admin",
        "internal-auditor",
        "internal-org-admin",
        "internal-viewer",
      ].sort(),
    );
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

  it("submits the typed identity with the chosen role (Dev login)", async () => {
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
    await user.selectOptions(screen.getByLabelText(/role/i), "internal-viewer");
    await user.click(
      screen.getByRole("button", { name: "Sign in as Ada@Example.com" }),
    );

    await waitFor(() => expect(devLoginAction).toHaveBeenCalledTimes(1));
    const formData = devLoginAction.mock.calls[0]?.[1];
    expect(formData?.get("identity")).toBe("Ada@Example.com");
    expect(formData?.get("role")).toBe("internal-viewer");
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
