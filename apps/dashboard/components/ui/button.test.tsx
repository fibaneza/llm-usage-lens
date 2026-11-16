import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, buttonVariants } from "./button";

// Design System -- Layout, Panels and density (2026-11-16): controls are 32px
// on pointer-fine screens (`--spacing-control`), 44px touch below md; Focus:
// every primitive uses focus-visible ring-2 ring-focus-ring ring-offset-2 and
// never hides the outline (Rule 60.30).
const has = (className: string, token: string) =>
  className.split(/\s+/).includes(token);

describe("buttonVariants sizes", () => {
  it.each([
    ["default", "h-8"],
    ["sm", "h-8"],
    ["xs", "h-6"],
    ["icon", "size-8"],
    ["icon-sm", "size-8"],
  ] as const)("%s is %s on desktop", (size, token) => {
    expect(has(buttonVariants({ size }), token)).toBe(true);
  });

  it("does not use the old 36px default or icon sizes", () => {
    expect(has(buttonVariants({ size: "default" }), "h-9")).toBe(false);
    expect(has(buttonVariants({ size: "icon" }), "size-9")).toBe(false);
  });

  it("reaches the 44px touch floor below md", () => {
    expect(has(buttonVariants({ size: "default" }), "max-md:min-h-touch")).toBe(
      true,
    );
    const icon = buttonVariants({ size: "icon" });
    expect(has(icon, "max-md:min-h-touch")).toBe(true);
    expect(has(icon, "max-md:min-w-touch")).toBe(true);
  });
});

describe("Button", () => {
  it("shows a visible focus ring from the focus-ring token and never hides the outline", () => {
    render(<Button>Save</Button>);

    const className = screen.getByRole("button", { name: "Save" }).className;
    expect(className).toContain("focus-visible:ring-2");
    expect(className).toContain("focus-visible:ring-focus-ring");
    expect(className).toContain("focus-visible:ring-offset-2");
    expect(has(className, "outline-none")).toBe(false);
  });

  it("uses the 6px control radius and no shadow on the outline variant", () => {
    render(<Button variant="outline">Export</Button>);

    const className = screen.getByRole("button", { name: "Export" }).className;
    expect(has(className, "rounded-control")).toBe(true);
    expect(has(className, "shadow-xs")).toBe(false);
  });

  it("keeps the data-variant hook", () => {
    render(
      <Button variant="ghost" size="icon-sm" aria-label="Edit">
        x
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute(
      "data-variant",
      "ghost",
    );
  });
});
