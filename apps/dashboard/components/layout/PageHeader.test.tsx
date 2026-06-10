import { render, screen } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader";

// PageHeader embeds the nuqs-backed DateRangePicker, so it renders behind the
// testing adapter.
const wrapper = withNuqsTestingAdapter({ searchParams: {} });

describe("PageHeader", () => {
  it("renders the description when provided", () => {
    render(<PageHeader description="Spend broken down by department." />, {
      wrapper,
    });
    expect(
      screen.getByText("Spend broken down by department."),
    ).toBeInTheDocument();
  });

  it("renders the global date range filter", () => {
    render(<PageHeader description="Anything" />, { wrapper });
    expect(
      screen.getByRole("button", { name: /last 30 days/i }),
    ).toBeInTheDocument();
  });

  it("omits the description paragraph when none is given", () => {
    const { container } = render(<PageHeader />, { wrapper });
    // The date filter still renders; only the description paragraph is absent.
    expect(
      screen.getByRole("button", { name: /last 30 days/i }),
    ).toBeInTheDocument();
    expect(container.querySelector("p")).toBeNull();
  });
});
