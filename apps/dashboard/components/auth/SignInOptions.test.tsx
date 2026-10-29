import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SignInOptions } from "./SignInOptions";

// Props: `entra` / `devLogin` flags plus one server-action prop per provider
// (`entraAction`, `devLoginAction`, each `() => Promise<void>`), passed to the
// matching <form action>. The page owns the actions; this component only
// renders one submit button per enabled provider (Rule 50.3).
const actions = {
  entraAction: vi.fn(async () => {}),
  devLoginAction: vi.fn(async () => {}),
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
