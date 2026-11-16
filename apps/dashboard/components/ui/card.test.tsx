import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

// The vendored shadcn Card is the base of MetricCard and the chart sections
// (Design System -- Component Inventory, `MetricCard`: "Custom (shadcn Card)").
describe("Card", () => {
  it("renders every part with its shadcn data-slot attribute", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Total Cost</CardTitle>
          <CardDescription>Last 30 days</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );

    const slotOf = (text: string) =>
      screen.getByText(text).closest("[data-slot]")?.getAttribute("data-slot");

    expect(slotOf("Total Cost")).toBe("card-title");
    expect(slotOf("Last 30 days")).toBe("card-description");
    expect(slotOf("Body")).toBe("card-content");
    expect(slotOf("Footer")).toBe("card-footer");
    expect(
      screen.getByText("Total Cost").closest('[data-slot="card-header"]'),
    ).not.toBeNull();
    expect(
      screen.getByText("Body").closest('[data-slot="card"]'),
    ).not.toBeNull();
  });

  it("renders children and merges a caller className", () => {
    render(
      <Card className="custom-class" data-testid="card">
        <CardContent>Inside</CardContent>
      </Card>,
    );

    const card = screen.getByTestId("card");
    expect(card).toHaveClass("custom-class");
    expect(card).toHaveAttribute("data-slot", "card");
    expect(card).toHaveTextContent("Inside");
  });

  // Design System -- Layout, Panels and density (2026-11-16): card background,
  // 1px border, --radius-card, no shadow, 16px padding.
  it("is a bordered 8px surface with no shadow and 16px padding", () => {
    render(
      <Card data-testid="card">
        <CardHeader data-testid="header">Head</CardHeader>
        <CardContent data-testid="content">Body</CardContent>
      </Card>,
    );

    const card = screen.getByTestId("card");
    expect(card).toHaveClass("border", "rounded-card", "py-4");
    expect(card.className).not.toMatch(/(^|\s)shadow(-|\s|$)/);
    expect(card.className).not.toMatch(/rounded-xl/);
    expect(screen.getByTestId("header")).toHaveClass("px-4");
    expect(screen.getByTestId("content")).toHaveClass("px-4");
  });

  it("forwards native props such as aria attributes", () => {
    render(
      <Card aria-label="Spend summary">
        <CardContent>Inside</CardContent>
      </Card>,
    );

    expect(screen.getByLabelText("Spend summary")).toHaveAttribute(
      "data-slot",
      "card",
    );
  });
});
