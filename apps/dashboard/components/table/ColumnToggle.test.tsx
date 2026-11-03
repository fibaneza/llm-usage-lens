import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ColumnToggle } from "./ColumnToggle";

// Design System -- Component Inventory, `ColumnToggle`: "Show/hide table
// columns" (shadcn DropdownMenu). One checkbox item per hideable column; the
// trigger button is labelled "Columns". The first argument of onToggle is the
// column id.
const columns = [
  { id: "cost", label: "Cost", visible: true },
  { id: "inputTokens", label: "Input Tokens", visible: true },
  { id: "invocations", label: "Invocations", visible: false },
];

async function openMenu() {
  const user = userEvent.setup();
  const onToggle = vi.fn<(id: string, visible?: boolean) => void>();
  render(<ColumnToggle columns={columns} onToggle={onToggle} />);
  await user.click(screen.getByRole("button", { name: "Columns" }));
  return { user, onToggle };
}

describe("ColumnToggle", () => {
  it("renders a Columns trigger and keeps the menu closed", () => {
    render(<ColumnToggle columns={columns} onToggle={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("lists one checkbox item per column, checked when the column is visible", async () => {
    await openMenu();

    const items = await screen.findAllByRole("menuitemcheckbox");
    expect(items.map((el) => el.textContent?.trim())).toEqual([
      "Cost",
      "Input Tokens",
      "Invocations",
    ]);
    expect(items.map((el) => el.getAttribute("aria-checked"))).toEqual([
      "true",
      "true",
      "false",
    ]);
  });

  it("reports the column id when an item is chosen", async () => {
    const { user, onToggle } = await openMenu();

    await user.click(
      await screen.findByRole("menuitemcheckbox", { name: "Invocations" }),
    );

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0]?.[0]).toBe("invocations");
  });

  it("reports the id of the column being hidden", async () => {
    const { user, onToggle } = await openMenu();

    await user.click(
      await screen.findByRole("menuitemcheckbox", { name: "Cost" }),
    );

    expect(onToggle.mock.calls[0]?.[0]).toBe("cost");
  });
});
