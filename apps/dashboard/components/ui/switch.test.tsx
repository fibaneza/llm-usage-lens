import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "./switch";

// Design System -- Component Inventory / Switches (2026-11-16): shadcn Switch,
// `role=switch`, `--color-input` track border when off, bg-primary when on;
// replaces two hand-rolled switches whose accessible names are e2e contracts.
describe("Switch", () => {
  it("is a switch named by its aria-label and reflects the checked state", () => {
    render(<Switch aria-label="bedrock/invoke" defaultChecked />);

    expect(
      screen.getByRole("switch", { name: "bedrock/invoke" }),
    ).toBeChecked();
  });

  it("toggles on click and reports the new value", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn<(checked: boolean) => void>();
    render(<Switch aria-label="op" onCheckedChange={onCheckedChange} />);

    await user.click(screen.getByRole("switch", { name: "op" }));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("switch", { name: "op" })).toBeChecked();
  });

  it("does not toggle while disabled", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch aria-label="op" disabled onCheckedChange={onCheckedChange} />,
    );

    await user.click(screen.getByRole("switch", { name: "op" }));

    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("uses the input token off, primary on, and the focus-ring token", () => {
    render(<Switch aria-label="op" />);

    const className = screen.getByRole("switch", { name: "op" }).className;
    expect(className).toContain("data-[state=checked]:bg-primary");
    expect(className).toContain("border-input");
    expect(className).toContain("focus-visible:ring-focus-ring");
  });
});
