import { render, screen, waitFor, within } from "@testing-library/react";
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
// Unit SI1 - Design System, Sign-in page, "The forms" (T-SI1, T-SI2, T-SI4);
// Access Control - Password users (Sign-in), threats T20 and T23.
type FormAction = (formData: FormData) => Promise<{ ok: false } | void>;
const GENERIC = "Those details are not right. Check them and try again.";
const HINT =
  "6-digit code from your authenticator app. Leave empty if you have not set one up.";

function ok() {
  return vi.fn<FormAction>(async () => undefined);
}
function refused() {
  return vi.fn<FormAction>(async () => ({ ok: false }));
}

function passwordOnly(passwordAction: FormAction = ok()) {
  return render(
    <SignInOptions
      entra={false}
      devLogin={false}
      password
      passwordAction={passwordAction}
      {...actions}
    />,
  );
}
function masterOnly(masterAction: FormAction = ok()) {
  return render(
    <SignInOptions
      entra={false}
      devLogin={false}
      master
      masterAction={masterAction}
      {...actions}
    />,
  );
}

// "A placeholder or an aria-label alone is not a label": a visible <label for>.
function expectVisibleLabel(input: HTMLElement, text: string) {
  expect(input.id).not.toBe("");
  expect(input).not.toHaveAttribute("aria-label");
  const label = document.querySelector(`label[for="${input.id}"]`);
  expect(label).not.toBeNull();
  expect(label?.textContent?.trim()).toBe(text);
  expect(label).toBeVisible();
}

function expectHint(input: HTMLElement) {
  const id = input.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  const hint = document.getElementById(String(id));
  expect(hint?.textContent?.trim()).toBe(HINT);
}

// A group is a <section aria-labelledby> or a <fieldset> with a legend.
function groupsOf(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      "section[aria-labelledby], fieldset",
    ),
  );
}
function titleOf(group: HTMLElement): string {
  if (group.tagName === "FIELDSET") {
    return group.querySelector("legend")?.textContent?.trim() ?? "";
  }
  const id = group.getAttribute("aria-labelledby") ?? "";
  return document.getElementById(id)?.textContent?.trim() ?? "";
}

describe("SignInOptions email and password form (T-SI1)", () => {
  it("binds a visible label and the autocomplete value to the email field (T-SI1, D-R3-15)", () => {
    passwordOnly();
    const email = screen.getByLabelText("Email", { exact: true });
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("name", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(email).toBeRequired();
    expectVisibleLabel(email, "Email");
  });

  it("binds a visible label and autocomplete to the password field (T-SI1)", () => {
    passwordOnly();
    const password = screen.getByLabelText("Password", { exact: true });
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("name", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toBeRequired();
    expectVisibleLabel(password, "Password");
  });

  // WCAG 4.1.2: the name states the action, aria-pressed the state.
  it("shows and hides the password with a toggle named Show/Hide password and aria-pressed (T-SI1)", async () => {
    passwordOnly();
    const user = userEvent.setup();
    const password = screen.getByLabelText("Password", { exact: true });
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Show password" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
    expect(
      screen.getByRole("button", { name: "Show password" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("labels the optional authenticator code and binds its hint by aria-describedby (T-SI1)", () => {
    passwordOnly();
    const code = screen.getByLabelText("Authenticator code");
    expect(code).toHaveAttribute("name", "totp");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).not.toBeRequired();
    expectVisibleLabel(code, "Authenticator code");
    expectHint(code);
  });

  it("has one submit button named Sign in, and prefills nothing (T-SI1, T-SI4: no echo)", () => {
    passwordOnly();
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveAttribute(
      "type",
      "submit",
    );
    for (const field of [
      screen.getByLabelText("Email", { exact: true }),
      screen.getByLabelText("Password", { exact: true }),
      screen.getByLabelText("Authenticator code"),
    ]) {
      expect(field).toHaveValue("");
    }
  });

  it("does not submit with GET, so nothing typed can reach the URL (T-SI4)", () => {
    const { container } = passwordOnly();
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form?.getAttribute("method")?.toLowerCase() ?? "post").not.toBe(
      "get",
    );
  });

  it("posts email, password and totp to the action (T-SI3, contract)", async () => {
    const passwordAction = ok();
    passwordOnly(passwordAction);
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Email", { exact: true }),
      "ada@example.com",
    );
    await user.type(screen.getByLabelText("Password", { exact: true }), "pw-1");
    await user.type(screen.getByLabelText("Authenticator code"), "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(passwordAction).toHaveBeenCalledTimes(1));
    const formData = passwordAction.mock.calls[0]?.[0];
    expect(formData?.get("email")).toBe("ada@example.com");
    expect(formData?.get("password")).toBe("pw-1");
    expect(formData?.get("totp")).toBe("123456");
  });
});

describe("SignInOptions master user form (T-SI1, T-SI2)", () => {
  it("keeps the master form out of the page until Sign in as master user is chosen, by click (T-SI2)", async () => {
    masterOnly();
    const disclosure = screen.getByRole("button", {
      name: "Sign in as master user",
    });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Username")).toBeNull();
    expect(screen.queryByLabelText("Authenticator code")).toBeNull();

    await userEvent.setup().click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
  });

  it.each(["{Enter}", " "])(
    "opens the master form from the keyboard (key %j) (T-SI2)",
    async (key) => {
      masterOnly();
      const user = userEvent.setup();
      await user.tab();
      const disclosure = screen.getByRole("button", {
        name: "Sign in as master user",
      });
      expect(disclosure).toHaveFocus();
      await user.keyboard(key);
      expect(disclosure).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByLabelText("Username")).toBeInTheDocument();
    },
  );

  it("labels Username, Password and Authenticator code visibly, with autocomplete and the same hint (T-SI1)", async () => {
    masterOnly();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Sign in as master user" }));

    const username = screen.getByLabelText("Username");
    expect(username).toHaveAttribute("name", "username");
    expect(username).toHaveAttribute("autocomplete", "username");
    expect(username).toBeRequired();
    expectVisibleLabel(username, "Username");

    const password = screen.getByLabelText("Password", { exact: true });
    expect(password).toHaveAttribute("name", "password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toBeRequired();
    expectVisibleLabel(password, "Password");

    const code = screen.getByLabelText("Authenticator code");
    expect(code).toHaveAttribute("name", "totp");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).not.toBeRequired();
    expectVisibleLabel(code, "Authenticator code");
    expectHint(code);
    for (const field of [username, password, code]) {
      expect(field).toHaveValue("");
    }
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveAttribute(
      "type",
      "submit",
    );
  });
});

describe("SignInOptions dev login labels (T-SI1)", () => {
  it("keeps visible labels on the dev login fields (T-SI1: kept, not aria-label)", () => {
    render(<SignInOptions entra={false} devLogin {...actions} />);
    for (const [field, text] of [
      [screen.getByLabelText(/^role/i), "Role"],
      [
        screen.getByLabelText("Sign in as (email or user id)"),
        "Sign in as (email or user id)",
      ],
    ] as const) {
      expect(field).not.toHaveAttribute("aria-label");
      const label = (field as HTMLInputElement).labels?.[0];
      expect(label).toBeVisible();
      expect(label?.textContent).toContain(text);
    }
  });
});

describe("SignInOptions groups per method (T-SI2)", () => {
  const ALL = {
    entra: true,
    devLogin: true,
    master: true,
    password: true,
  };
  const NONE = {
    entra: false,
    devLogin: false,
    master: false,
    password: false,
  };

  it.each([
    ["Microsoft only", { ...NONE, entra: true }, 1],
    ["dev login only", { ...NONE, devLogin: true }, 1],
    ["email and password only", { ...NONE, password: true }, 1],
    ["master only", { ...NONE, master: true }, 1],
    ["all four", ALL, 4],
    ["none", NONE, 0],
  ])(
    "renders one titled group per enabled method: %s (T-SI2)",
    (_name, flags, count) => {
      const { container } = render(
        <SignInOptions
          {...flags}
          passwordAction={ok()}
          masterAction={ok()}
          {...actions}
        />,
      );
      const groups = groupsOf(container);
      expect(groups).toHaveLength(count);
      const titles = groups.map(titleOf);
      for (const title of titles) expect(title).not.toBe("");
      expect(new Set(titles).size).toBe(titles.length);
    },
  );

  it("renders nothing for a method that is off, even when its action is given (T-SI2, T-SI5)", () => {
    render(
      <SignInOptions
        entra
        devLogin={false}
        master={false}
        password={false}
        passwordAction={ok()}
        masterAction={ok()}
        {...actions}
      />,
    );
    expect(screen.queryByLabelText("Email", { exact: true })).toBeNull();
    expect(screen.queryByLabelText("Authenticator code")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show password" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sign in as master user" }),
    ).toBeNull();
  });
});

describe("SignInOptions one generic failure message (T-SI4; Access Control T20, T23)", () => {
  async function submitPassword() {
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Email", { exact: true }),
      "ada@example.com",
    );
    await user.type(
      screen.getByLabelText("Password", { exact: true }),
      "wrong-password",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));
  }

  it("shows the generic alert and moves focus to Email after a refused password sign-in (T-SI4)", async () => {
    passwordOnly(refused());
    expect(screen.queryByRole("alert")).toBeNull();
    await submitPassword();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.trim()).toBe(GENERIC);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByLabelText("Email", { exact: true })).toHaveFocus(),
    );
  });

  it("shows no alert when the action succeeds (returns nothing) (T-SI4)", async () => {
    const passwordAction = ok();
    passwordOnly(passwordAction);
    await submitPassword();
    await waitFor(() => expect(passwordAction).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the same alert and focuses Username after a refused master sign-in (T-SI4)", async () => {
    masterOnly(refused());
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Sign in as master user" }),
    );
    await user.type(screen.getByLabelText("Username"), "root");
    await user.type(
      screen.getByLabelText("Password", { exact: true }),
      "wrong-password",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.trim()).toBe(GENERIC);
    await waitFor(() =>
      expect(screen.getByLabelText("Username")).toHaveFocus(),
    );
  });

  it("puts the alert in the group that failed, not in the other (T-SI4, T-SI2)", async () => {
    const { container } = render(
      <SignInOptions
        entra={false}
        devLogin={false}
        master
        password
        masterAction={ok()}
        passwordAction={refused()}
        {...actions}
      />,
    );
    await submitPassword();
    const alert = await screen.findByRole("alert");
    const group = groupsOf(container).find((g) => g.contains(alert));
    expect(group).toBeDefined();
    expect(
      within(group as HTMLElement).getByLabelText("Email", { exact: true }),
    ).toBeInTheDocument();
    expect(
      within(group as HTMLElement).queryByLabelText("Username"),
    ).toBeNull();
  });
});

// Design System - Sign-in page, The forms (T-SI1, T-SI4); WCAG 3.3.1 and 4.1.2:
// while the group's failure alert shows, every input of that group points at it
// (aria-describedby, the code field keeping its hint id too) and is
// aria-invalid; with no failure neither attribute is set.
describe("SignInOptions failure association (T-SI1, T-SI4; WCAG 3.3.1)", () => {
  function inputsOf(group: HTMLElement) {
    return Array.from(group.querySelectorAll<HTMLInputElement>("input"));
  }
  function expectNoFailureMarks(group: HTMLElement) {
    for (const input of inputsOf(group)) {
      expect(input).not.toHaveAttribute("aria-invalid");
      if (input.name === "totp") expectHint(input);
      else expect(input).not.toHaveAttribute("aria-describedby");
    }
  }
  function expectFailureMarks(group: HTMLElement, alert: HTMLElement) {
    expect(alert.id).not.toBe("");
    const inputs = inputsOf(group);
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input).toHaveAttribute("aria-invalid", "true");
      const ids = (input.getAttribute("aria-describedby") ?? "").split(/\s+/);
      expect(ids).toContain(alert.id);
      if (input.name === "totp") {
        const hintId = ids.find((id) => id !== alert.id);
        expect(
          document.getElementById(String(hintId))?.textContent?.trim(),
        ).toBe(HINT);
      }
    }
  }

  it("marks every password-group input invalid and described by the alert after a refusal, and none before (T-SI4)", async () => {
    const { container } = passwordOnly(refused());
    const group = groupsOf(container)[0] as HTMLElement;
    expectNoFailureMarks(group);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email", { exact: true }), "a@b.co");
    await user.type(screen.getByLabelText("Password", { exact: true }), "x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expectFailureMarks(group, await screen.findByRole("alert"));
  });

  it("marks every master-group input invalid and described by the alert after a refusal, and none before (T-SI4)", async () => {
    const { container } = masterOnly(refused());
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Sign in as master user" }),
    );
    const group = groupsOf(container)[0] as HTMLElement;
    expectNoFailureMarks(group);

    await user.type(screen.getByLabelText("Username"), "root");
    await user.type(screen.getByLabelText("Password", { exact: true }), "x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expectFailureMarks(group, await screen.findByRole("alert"));
  });
});
