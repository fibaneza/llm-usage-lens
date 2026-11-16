import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TableToolbar } from "./TableToolbar";

// Design System -- Component Inventory, `TableToolbar` (2026-11-16): one-row
// table toolbar; start slot (search, filters) then end slot (Columns, Export).
describe("TableToolbar", () => {
  it("renders the start slot before the end slot inside a data-slot toolbar", () => {
    const { container } = render(
      <TableToolbar
        start={<input type="search" aria-label="Search by name" />}
        end={<button type="button">Export CSV</button>}
      />,
    );

    const root = container.querySelector('[data-slot="table-toolbar"]');
    expect(root).not.toBeNull();
    const search = screen.getByRole("searchbox", { name: "Search by name" });
    const exportButton = screen.getByRole("button", { name: "Export CSV" });
    expect(root?.contains(search)).toBe(true);
    expect(root?.contains(exportButton)).toBe(true);
    expect(
      search.compareDocumentPosition(exportButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders with only one slot and merges a caller className", () => {
    const { container } = render(
      <TableToolbar end={<span>only end</span>} className="custom-class" />,
    );

    expect(screen.getByText("only end")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="table-toolbar"]')).toHaveClass(
      "custom-class",
    );
  });
});
