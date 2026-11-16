import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Input } from "./input";

// Design System -- Typography (inputs 16px below md, 14px from md), Layout
// (32px controls, 44px touch below md), Focus (ring-focus-ring), Color Palette
// (`--color-input` boundary).
describe("Input", () => {
  it("is 32px tall with 16px text below md and 14px from md", () => {
    render(<Input aria-label="Name" />);

    const tokens = screen
      .getByRole("textbox", { name: "Name" })
      .className.split(/\s+/);
    expect(tokens).toContain("h-8");
    expect(tokens).toContain("text-base");
    expect(tokens).toContain("md:text-sm");
    expect(tokens).toContain("max-md:min-h-touch");
    expect(tokens).not.toContain("h-9");
  });

  it("uses the input border token and the focus-ring token without hiding the outline", () => {
    render(<Input aria-label="Name" />);

    const className = screen.getByRole("textbox", { name: "Name" }).className;
    expect(className).toContain("border-input");
    expect(className).toContain("focus-visible:ring-focus-ring");
    expect(className.split(/\s+/)).not.toContain("outline-none");
  });
});
