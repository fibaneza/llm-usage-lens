import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

// The vendored shadcn Table is the base of UsageTable (Design System --
// Component Inventory, `UsageTable`: "TanStack Table + shadcn Table"). Each part
// carries its shadcn data-slot attribute; the table scrolls inside its own
// container so the page never scrolls horizontally (Design System --
// Responsive Tables).
function renderTable() {
  return render(
    <Table>
      <TableCaption>Departments ranking</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead aria-sort="ascending">Name</TableHead>
          <TableHead>Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="custom-cell">Alpha</TableCell>
          <TableCell>12.5</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe("Table", () => {
  it("renders every part with its shadcn data-slot attribute", () => {
    renderTable();

    const slotOf = (text: string) =>
      screen.getByText(text).closest("[data-slot]")?.getAttribute("data-slot");

    expect(slotOf("Departments ranking")).toBe("table-caption");
    expect(slotOf("Name")).toBe("table-head");
    expect(slotOf("Alpha")).toBe("table-cell");
    expect(screen.getByRole("table")).toHaveAttribute("data-slot", "table");
    expect(
      screen.getByText("Name").closest('[data-slot="table-header"]'),
    ).not.toBeNull();
    expect(
      screen.getByText("Alpha").closest('[data-slot="table-body"]'),
    ).not.toBeNull();
    expect(
      screen.getByText("Alpha").closest('[data-slot="table-row"]'),
    ).not.toBeNull();
  });

  it("renders as an accessible table named by its caption", () => {
    renderTable();

    expect(
      screen.getByRole("table", { name: "Departments ranking" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Cost" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "12.5" })).toBeInTheDocument();
  });

  it("passes extra props and class names through", () => {
    renderTable();

    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(screen.getByText("Alpha")).toHaveClass("custom-cell");
  });

  // Design System -- Layout, Panels and density + Table spec (2026-11-16):
  // bordered 8px container, no shadow, 32px sticky 12px muted header row,
  // 13px cells with 12px horizontal padding.
  it("is a bordered 8px container with no shadow", () => {
    renderTable();

    const container = screen.getByRole("table").parentElement;
    expect(container).toHaveClass("rounded-card", "border");
    expect(container?.className).not.toMatch(/(^|\s)shadow(-|\s|$)/);
  });

  it("renders the header row 32px tall, 12px medium muted and sticky", () => {
    renderTable();

    const head = screen.getByRole("columnheader", { name: "Cost" });
    expect(head).toHaveClass("text-xs", "font-medium", "text-muted-foreground");
    expect(head.className).toMatch(
      /(^|\s)h-(row-head|\(--spacing-row-head\))(\s|$)/,
    );
    expect(head).toHaveClass("sticky");
  });

  it("renders body cells at 13px with 12px horizontal padding", () => {
    renderTable();

    expect(screen.getByRole("cell", { name: "12.5" })).toHaveClass(
      "text-cell",
      "px-3",
      "py-2",
    );
  });

  it("scrolls horizontally inside its own container, not the page", () => {
    renderTable();

    expect(screen.getByRole("table").parentElement).toHaveClass(
      "overflow-x-auto",
    );
  });
});
