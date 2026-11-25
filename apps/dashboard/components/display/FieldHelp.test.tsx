import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FieldHelp } from "./FieldHelp";

// Source: Design System - Component Inventory, FieldHelp (D-R3-10, 2026-11-25),
// and Users, round 3, T-UP3: an icon-only button named "About <field>"; a
// click or Enter opens a popover with the text; Escape or a click outside
// closes it and focus returns to the button; never a hover-only tooltip.
// The axe check at 375px and desktop runs in e2e (manage-users.spec.ts,
// manage-user-page.spec.ts): the component suite has no axe library.
const TEXT = "Whether members see this team's total cost and its breakdowns.";

function show() {
  return render(
    <div>
      <FieldHelp field="Team totals">{TEXT}</FieldHelp>
      <button type="button">Elsewhere</button>
    </div>,
  );
}
const trigger = () => screen.getByRole("button", { name: "About Team totals" });

describe("FieldHelp (T-UP3)", () => {
  it("renders one icon-only button named 'About <field>' and keeps the text closed", () => {
    show();
    expect(trigger()).toBeVisible();
    expect(trigger()).toHaveTextContent("");
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it("a click opens the popover with the text", async () => {
    show();
    await userEvent.setup().click(trigger());
    expect(await screen.findByText(TEXT)).toBeVisible();
  });

  it("Enter on the focused button opens it", async () => {
    show();
    const user = userEvent.setup();
    await user.tab();
    expect(trigger()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText(TEXT)).toBeVisible();
  });

  it("Escape closes it and focus returns to the button", async () => {
    show();
    const user = userEvent.setup();
    await user.click(trigger());
    await screen.findByText(TEXT);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText(TEXT)).toBeNull());
    expect(trigger()).toHaveFocus();
  });

  it("a click outside closes it and focus returns to the button", async () => {
    show();
    const user = userEvent.setup();
    await user.click(trigger());
    await screen.findByText(TEXT);
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByText(TEXT)).toBeNull());
    expect(trigger()).toHaveFocus();
  });

  it("hover alone opens nothing (never hover-only)", async () => {
    show();
    await userEvent.setup().hover(trigger());
    expect(screen.queryByText(TEXT)).toBeNull();
  });
});
