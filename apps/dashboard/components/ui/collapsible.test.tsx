import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible";

// Design System -- Component Inventory, `Switch`, `Collapsible` (2026-11-16):
// disclosure of secondary content (LiteLLM "Enforced in code").
describe("Collapsible", () => {
  it("shows its content when open by default and hides it after the trigger is used", async () => {
    const user = userEvent.setup();
    render(
      <Collapsible defaultOpen>
        <CollapsibleTrigger>Enforced in code</CollapsibleTrigger>
        <CollapsibleContent>Only allowlisted routes</CollapsibleContent>
      </Collapsible>,
    );
    const trigger = screen.getByRole("button", { name: "Enforced in code" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Only allowlisted routes")).toBeVisible();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText("Only allowlisted routes"),
    ).not.toBeInTheDocument();
  });

  it("starts closed without defaultOpen and opens on click", async () => {
    const user = userEvent.setup();
    render(
      <Collapsible>
        <CollapsibleTrigger>More</CollapsibleTrigger>
        <CollapsibleContent>Details</CollapsibleContent>
      </Collapsible>,
    );
    expect(screen.queryByText("Details")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More" }));

    expect(screen.getByText("Details")).toBeVisible();
  });
});
