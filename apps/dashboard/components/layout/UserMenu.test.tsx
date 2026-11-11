import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UserMenu, type UserMenuUser } from "./UserMenu";

// Design System — Authentication, *User menu*: the menu shows the caller's
// role label(s) in `GLOBAL_ROLES` order, comma-separated (a session role with
// no label is not shown), and the sign-in method label (none when
// `authMethod` is absent or invalid). Strings come from `lib/auth/roles.ts`.

// The session is wider than the menu's prop type until the component accepts
// `roles` and `authMethod`; unknown values are passed deliberately.
function makeUser(extra: Record<string, unknown> = {}): UserMenuUser {
  return {
    name: "Ada Lovelace",
    email: "ada@example.test",
    ...extra,
  } as UserMenuUser;
}

async function openMenu(user: UserMenuUser) {
  const events = userEvent.setup();
  render(<UserMenu user={user} signOutAction={vi.fn(async () => {})} />);
  await events.click(screen.getByRole("button", { name: "Open user menu" }));
  return screen.getByRole("menu");
}

const METHOD_LABELS = [
  "Microsoft Entra ID",
  "Master user (break-glass)",
  "Local login (dev)",
];

describe("UserMenu roles", () => {
  it("shows the label of a single role", async () => {
    const menu = await openMenu(makeUser({ roles: ["internal-viewer"] }));

    expect(menu).toHaveTextContent("Viewer");
    expect(menu).not.toHaveTextContent("internal-viewer");
  });

  it("shows several roles in GLOBAL_ROLES order, comma-separated, whatever the session order", async () => {
    const menu = await openMenu(
      makeUser({
        roles: ["internal-viewer", "internal-auditor", "internal-admin"],
      }),
    );

    expect(menu).toHaveTextContent("Admin, Auditor, Viewer");
  });

  it("labels internal-org-admin as Org admin", async () => {
    const menu = await openMenu(makeUser({ roles: ["internal-org-admin"] }));

    expect(menu).toHaveTextContent("Org admin");
  });

  it("omits a role with no label and keeps the labelled ones", async () => {
    const menu = await openMenu(
      makeUser({
        roles: ["Reader", "internal-auditor", "internal-team-admin"],
      }),
    );

    expect(menu).toHaveTextContent("Auditor");
    expect(menu).not.toHaveTextContent("Reader");
    expect(menu).not.toHaveTextContent("internal-team-admin");
    expect(menu).not.toHaveTextContent("Auditor,");
  });

  it("shows no role text when the only role has no label", async () => {
    const menu = await openMenu(makeUser({ roles: ["Reader"] }));

    expect(menu).not.toHaveTextContent("Reader");
    expect(menu).not.toHaveTextContent("Viewer");
    expect(menu).not.toHaveTextContent("Admin");
  });
});

describe("UserMenu sign-in method", () => {
  it.each([
    ["entra", "Microsoft Entra ID"],
    ["master", "Master user (break-glass)"],
    ["local", "Local login (dev)"],
  ])("shows the %s method as %s and no other method", async (method, label) => {
    const menu = await openMenu(makeUser({ authMethod: method }));

    expect(menu).toHaveTextContent(label);
    for (const other of METHOD_LABELS.filter((l) => l !== label)) {
      expect(menu).not.toHaveTextContent(other);
    }
  });

  it("shows no sign-in method when authMethod is missing", async () => {
    const menu = await openMenu(makeUser({ roles: ["internal-viewer"] }));

    for (const label of METHOD_LABELS) {
      expect(menu).not.toHaveTextContent(label);
    }
  });

  it("shows no sign-in method for an unrecognised authMethod", async () => {
    const menu = await openMenu(makeUser({ authMethod: "saml" }));

    for (const label of METHOD_LABELS) {
      expect(menu).not.toHaveTextContent(label);
    }
    expect(menu).not.toHaveTextContent("saml");
  });
});

describe("UserMenu identity and sign out (unchanged)", () => {
  it("still shows the name, the email and Sign out", async () => {
    const menu = await openMenu(
      makeUser({ roles: ["internal-admin"], authMethod: "entra" }),
    );

    expect(menu).toHaveTextContent("Ada Lovelace");
    expect(menu).toHaveTextContent("ada@example.test");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  });
});
