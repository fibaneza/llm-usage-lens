import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./breadcrumb";

// Design System -- Component Inventory, `Breadcrumb` (2026-11-16): detail-page
// trail; a navigation landmark named "Breadcrumb" whose last item is the
// current page.
function renderTrail() {
  return render(
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/dashboard/departments">
            Departments
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Engineering</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>,
  );
}

describe("Breadcrumb", () => {
  it("is a navigation landmark named Breadcrumb with a link to the list page", () => {
    renderTrail();

    expect(
      screen.getByRole("navigation", { name: "Breadcrumb" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Departments" })).toHaveAttribute(
      "href",
      "/dashboard/departments",
    );
  });

  it("marks the last crumb as the current page and not a link", () => {
    renderTrail();

    expect(screen.getByText("Engineering")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.queryByRole("link", { name: "Engineering" }),
    ).not.toBeInTheDocument();
  });
});
