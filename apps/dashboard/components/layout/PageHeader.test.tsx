import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader";

// Design System -- Component Inventory, `PageHeader` and Layout, Page frame
// (2026-11-16): breadcrumb on detail pages, entity title as `h2`, one-line
// description, actions right, tabs and a toolbar slot. The page `h1` stays in
// the top bar, so PageHeader never renders an h1.
describe("PageHeader", () => {
  it("renders a breadcrumb trail whose last crumb is the current page", () => {
    render(
      <PageHeader
        breadcrumb={[
          { label: "Departments", href: "/dashboard/departments?dateFrom=x" },
          { label: "Engineering" },
        ]}
        title="Engineering"
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(
      within(nav).getByRole("link", { name: "Departments" }),
    ).toHaveAttribute("href", "/dashboard/departments?dateFrom=x");
    expect(within(nav).getByText("Engineering")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders the entity title as an h2, never an h1", () => {
    render(<PageHeader title="Platform" />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Platform" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("renders no breadcrumb or heading on a list page with only a description", () => {
    render(<PageHeader description="Who spends the most." />);

    expect(screen.getByText("Who spends the most.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders meta, actions, tabs and the toolbar children", () => {
    render(
      <PageHeader
        title="Platform"
        meta={<span>Bedrock service charges only</span>}
        actions={<button type="button">Download statement</button>}
        tabs={<div role="tablist" aria-label="Views" />}
      >
        <div role="search">toolbar</div>
      </PageHeader>,
    );

    expect(
      screen.getByText("Bedrock service charges only"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download statement" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Views" })).toBeInTheDocument();
    expect(screen.getByRole("search")).toHaveTextContent("toolbar");
  });

  // Design System - Layout, Page frame: the ScopeLine sits under the
  // description and is omitted when it has nothing to say (slice B1, B1-10;
  // prop `scopeLine={{ label, names }}`).
  it("renders the scope line under the description", () => {
    render(
      <PageHeader
        description="Spend for your teams."
        scopeLine={{
          label: "Showing teams you lead",
          names: ["Platform", "Checkout"],
        }}
        tabs={<div role="tablist" aria-label="Views" />}
      />,
    );

    const description = screen.getByText("Spend for your teams.");
    const scope = screen.getByText(/Showing teams you lead/);
    expect(scope).toHaveTextContent(
      "Showing teams you lead: Platform, Checkout",
    );
    expect(
      Boolean(
        description.compareDocumentPosition(scope) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        scope.compareDocumentPosition(screen.getByRole("tablist")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("renders no scope line when the caller sees everything (no scopeLine) or the scope has no names", () => {
    const { rerender } = render(<PageHeader description="All spend." />);
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();

    rerender(
      <PageHeader
        description="All spend."
        scopeLine={{ label: "Showing teams you lead", names: [] }}
      />,
    );
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();
  });

  it("orders breadcrumb, title, description, tabs, then toolbar", () => {
    render(
      <PageHeader
        breadcrumb={[
          { label: "Teams", href: "/dashboard/teams" },
          { label: "Core" },
        ]}
        title="Core"
        description="Team detail."
        tabs={<div role="tablist" aria-label="Views" />}
      >
        <div role="search" />
      </PageHeader>,
    );

    const follows = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    const title = screen.getByRole("heading", { level: 2 });
    const description = screen.getByText("Team detail.");
    const tabs = screen.getByRole("tablist");
    const toolbar = screen.getByRole("search");
    expect(follows(crumbs, title)).toBe(true);
    expect(follows(title, description)).toBe(true);
    expect(follows(description, tabs)).toBe(true);
    expect(follows(tabs, toolbar)).toBe(true);
  });
});
