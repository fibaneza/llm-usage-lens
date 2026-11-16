import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

// Design System -- Component Inventory / Color Palette (2026-11-16): status
// pills `success`, `warning`, `muted`; success text uses `--color-success-text`
// (4.5:1), never the icon-only `--color-success`.
describe("Badge", () => {
  it.each(["success", "warning", "muted"] as const)(
    "renders the %s status variant as a pill",
    (variant) => {
      render(<Badge variant={variant}>Status</Badge>);

      const badge = screen.getByText("Status");
      expect(badge).toHaveAttribute("data-variant", variant);
      expect(badge).toHaveClass("rounded-full");
    },
  );

  it("uses the success-text token for success text", () => {
    render(<Badge variant="success">Active</Badge>);

    const tokens = screen.getByText("Active").className.split(/\s+/);
    expect(tokens).toContain("text-success-text");
    expect(tokens).not.toContain("text-success");
  });

  it("renders the muted variant on the muted surface", () => {
    render(<Badge variant="muted">Paused</Badge>);

    expect(screen.getByText("Paused")).toHaveClass("bg-muted");
  });
});
