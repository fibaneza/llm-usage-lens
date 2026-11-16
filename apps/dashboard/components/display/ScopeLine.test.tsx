import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScopeLine } from "./ScopeLine";

// Source: Design System - Layout, Page frame: "a `ScopeLine` sits under the
// description and states the scope ('Showing teams you lead: Platform,
// Checkout'); it lists the in-scope names only"; slice B1 brief B1-10
// (props { label: string; names: readonly string[] }, renders nothing when
// names is empty).
describe("ScopeLine", () => {
  it("states the label followed by the in-scope names", () => {
    const { container } = render(
      <ScopeLine
        label="Showing teams you lead"
        names={["Platform", "Checkout"]}
      />,
    );

    expect(container).toHaveTextContent(
      "Showing teams you lead: Platform, Checkout",
    );
  });

  it("lists a single name without a separator", () => {
    const { container } = render(
      <ScopeLine label="Showing teams you lead" names={["Platform"]} />,
    );

    expect(container).toHaveTextContent("Showing teams you lead: Platform");
    expect(container).not.toHaveTextContent(",");
  });

  it("renders nothing when there are no names (never an empty or misleading line)", () => {
    const { container } = render(
      <ScopeLine label="Showing teams you lead" names={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();
  });
});
