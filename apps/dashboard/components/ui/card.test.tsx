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
